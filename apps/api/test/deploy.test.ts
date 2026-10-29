import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { parse } from 'yaml';
import { migrateDeploy } from '../scripts/embedded-pg.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

/**
 * What can be verified about the deployment without Docker: the compose/Caddy/Dockerfile
 * invariants, and — against real PostgreSQL — that the production role setup (deploy/postgres)
 * lets the app work while denying it schema changes and history rewrites.
 */
const DEPLOY = resolve(import.meta.dirname, '../../../deploy');
const read = (p: string) => readFileSync(resolve(DEPLOY, p), 'utf8');

interface Service {
  ports?: string[];
  environment?: Record<string, string>;
  env_file?: string;
  profiles?: string[];
  networks?: string[];
  read_only?: boolean;
  security_opt?: string[];
  command?: string[];
}
const compose = parse(read('docker-compose.yml'), { merge: true }) as {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean }>;
};
const svc = compose.services;

describe('deployment configuration', () => {
  it('publishes only Caddy; database and API stay on the private network', () => {
    expect(Object.keys(svc).sort()).toEqual(['api', 'db', 'migrate', 'web']);
    expect(svc.web!.ports).toEqual(['80:80', '443:443', '443:443/udp']);
    for (const name of ['db', 'api', 'migrate']) expect(svc[name]!.ports).toBeUndefined();
    expect(compose.networks.backend!.internal).toBe(true);
    expect(svc.db!.networks).toEqual(['backend']);
    expect(svc.web!.networks).toEqual(['frontend']);
  });

  it('runs the API as the restricted role with production settings, migrations as the owner', () => {
    const api = svc.api!.environment!;
    expect(api.DATABASE_URL).toMatch(
      /^postgresql:\/\/kirana_app:\$\{KIRANA_APP_PASSWORD\}@db:5432\/kirana\?/,
    );
    expect(api).toMatchObject({ NODE_ENV: 'production', COOKIE_SECURE: 'true', TRUST_PROXY: '1' });
    expect(api.WEB_ORIGINS).toMatch(/^https:\/\/\$\{DOMAIN/);
    expect(svc.api!.env_file).toBe('api.env');
    expect(svc.api!.read_only).toBe(true);
    expect(svc.api!.security_opt).toContain('no-new-privileges:true');

    expect(svc.migrate!.profiles).toEqual(['migrate']);
    expect(svc.migrate!.environment!.DATABASE_URL).toMatch(/^postgresql:\/\/kirana_owner:/);
    expect(svc.migrate!.command).toEqual(['npx', 'prisma', 'migrate', 'deploy']);
  });

  it('keeps every secret out of the files: compose interpolates, examples hold placeholders', () => {
    const yml = read('docker-compose.yml');
    // Every *PASSWORD: value in the compose file is a ${...} interpolation, never a literal.
    expect(yml).not.toMatch(/^\s*\w*PASSWORD:\s*[^$\s]/m);
    for (const f of ['.env.example', 'api.env.example']) {
      for (const line of read(f).split('\n')) {
        if (/^\s*[A-Z_]*(PASSWORD|KEY)\s*=/.test(line)) expect(line, f).toMatch(/CHANGE_ME/);
      }
    }
    const ignored = readFileSync(resolve(DEPLOY, '../.gitignore'), 'utf8');
    expect(ignored).toMatch(/^\.env\.\*$/m);
    expect(ignored).toMatch(/^deploy\/api\.env$/m);
    const dockerignore = readFileSync(resolve(DEPLOY, '../.dockerignore'), 'utf8');
    expect(dockerignore).toMatch(/^deploy\/\.env$/m);
    expect(dockerignore).toMatch(/^deploy\/api\.env$/m);
  });

  it('api.env.example is accepted by the API configuration as compose completes it', () => {
    const env = Object.fromEntries(
      read('api.env.example')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.split(/=(.*)/s).slice(0, 2) as [string, string]),
    );
    for (const k of ['DATABASE_URL', 'NODE_ENV', 'PORT', 'WEB_ORIGINS', 'COOKIE_SECURE', 'TRUST_PROXY']) {
      expect(env[k], `${k} is set by compose`).toBeUndefined();
    }
    const config = loadConfig({
      ...env,
      ...svc.api!.environment,
      // What compose interpolates from deploy/.env:
      DATABASE_URL: 'postgresql://kirana_app:x@db:5432/kirana?schema=public',
      WEB_ORIGINS: 'https://billing.example.in',
      LOG_LEVEL: 'info',
    });
    expect(config).toMatchObject({ nodeEnv: 'production', cookieSecure: true, trustProxy: 1 });
  });

  it('Caddy proxies the API, allows the microphone, and sets a CSP', () => {
    const caddy = read('Caddyfile');
    expect(caddy).toMatch(/reverse_proxy api:4000/);
    expect(caddy).toMatch(/Permissions-Policy "microphone=\(self\)/);
    expect(caddy).toMatch(/Content-Security-Policy "default-src 'self'; script-src 'self';/);
    expect(caddy).toMatch(/max_size 3MB/); // above the API's 2 MB CSV import limit
  });

  it('images run as non-root with a readiness health check', () => {
    const api = read('Dockerfile.api');
    expect(api).toMatch(/^USER node$/m);
    expect(api).toMatch(/health\/ready/);
    expect(read('Dockerfile.web')).toMatch(/^FROM caddy:/m);
  });

  it('shell scripts are strict and have Unix line endings', () => {
    for (const f of [
      'scripts/deploy.sh',
      'scripts/backup.sh',
      'scripts/restore.sh',
      'scripts/vps-check.sh',
      'postgres/init/10-roles.sh',
    ]) {
      const s = read(f);
      expect(s, f).not.toMatch(/\r/);
      expect(s.startsWith('#!/'), f).toBe(true);
      expect(s, f).toMatch(/^set -(eu|euo pipefail|uo pipefail)$/m);
    }
    expect(read('scripts/restore.sh')).toMatch(/CONFIRM=replace-live-database/);
    // Migrations run only after a verified backup when there is data.
    const deploy = read('scripts/deploy.sh');
    expect(deploy.indexOf('backup.sh')).toBeLessThan(deploy.indexOf('--profile migrate run'));
  });
});

/** Runs a plain-SQL file the way psql would with -v variables (no meta-commands are used). */
function sqlStatements(sql: string, vars: Record<string, string>): string[] {
  const filled = sql
    .replace(/:'(\w+)'/g, (_, k: string) => `'${vars[k]!.replace(/'/g, "''")}'`)
    .replace(/:"(\w+)"/g, (_, k: string) => `"${vars[k]}"`)
    .replace(/^--.*$/gm, '');
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  for (const line of filled.split('\n')) {
    buf += `${line}\n`;
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

describe('least-privilege database roles (real PostgreSQL)', () => {
  const base = new URL(inject('databaseUrl'));
  const urlFor = (user: string, password: string, db: string) => {
    const u = new URL(base);
    u.username = user;
    u.password = password;
    u.pathname = `/${db}`;
    return u.toString();
  };
  const DB = 'kirana_lp';
  const OWNER_PW = 'owner-pw-0123456789abcdef';
  const APP_PW = "app-pw-'quoted'-0123";
  const superDefault = new PrismaClient({ datasourceUrl: base.toString() });
  let superLp: PrismaClient;
  let appDb: PrismaClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await superDefault.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    for (const role of ['kirana_app', 'kirana_owner']) {
      const exists = await superDefault.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM pg_roles WHERE rolname = '${role}'`,
      );
      if (exists.length) await superDefault.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
    await superDefault.$executeRawUnsafe(`CREATE DATABASE ${DB}`);
    superLp = new PrismaClient({ datasourceUrl: urlFor(base.username, base.password, DB) });
    for (const stmt of sqlStatements(read('postgres/roles.sql'), {
      owner_password: OWNER_PW,
      app_password: APP_PW,
      dbname: DB,
    })) {
      await superLp.$executeRawUnsafe(stmt);
    }
    // Exactly what the migrate service does: prisma migrate deploy as the schema owner.
    migrateDeploy(urlFor('kirana_owner', OWNER_PW, DB));
    for (const stmt of sqlStatements(read('postgres/grants.sql'), {})) await superLp.$executeRawUnsafe(stmt);

    appDb = new PrismaClient({ datasourceUrl: urlFor('kirana_app', APP_PW, DB) });
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: urlFor('kirana_app', APP_PW, DB),
      WEB_ORIGINS: 'https://billing.example.in',
      COOKIE_SECURE: 'true',
      TRUST_PROXY: '1',
    });
    app = createApp({ config, db: appDb, logger: pino({ level: 'silent' }) });
  }, 120_000);

  afterAll(async () => {
    await appDb?.$disconnect();
    await superLp?.$disconnect();
    await superDefault.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await superDefault.$disconnect();
  });

  it('serves the whole billing flow as kirana_app with production cookies', async () => {
    // Secure (__Host-) cookies are not replayed by supertest over plain HTTP, so carry it by hand,
    // as Caddy's HTTPS would.
    let cookie = '';
    const call = (
      method: 'get' | 'post' | 'patch',
      path: string,
      body?: object,
      headers: Record<string, string> = {},
    ) => {
      const agent = request(app);
      const r = agent[method](`/api/v1${path}`).set('Origin', 'https://billing.example.in').set(headers);
      if (cookie) r.set('Cookie', cookie);
      return body ? r.send(body) : r;
    };

    const reg = await call('post', '/auth/register', {
      email: 'owner@example.in',
      password: 'a sufficiently long password',
      displayName: 'Owner',
    }).expect(201);
    const setCookie = reg.headers['set-cookie'] as unknown as string[];
    expect(setCookie[0]).toMatch(/^__Host-/);
    for (const attr of [/;\s*Secure/i, /;\s*HttpOnly/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i]) {
      expect(setCookie[0]).toMatch(attr);
    }
    cookie = setCookie[0]!.split(';')[0]!;

    const store = (await call('post', '/stores', { name: 'Lakshmi Kirana' }).expect(201)).body.store;
    await call('patch', `/stores/${store.id}`, { gstin: '36AABCU9603R1ZO', invoicePrefix: 'LK' }).expect(200);
    const s = `/stores/${store.id}`;
    const rice = (
      await call('post', `${s}/products`, {
        name: 'Rice',
        localNames: { te: 'బియ్యం' },
        unit: 'KG',
        sellingPrice: '62',
        taxRate: '5',
        openingStock: '10',
      }).expect(201)
    ).body.product;
    await call(
      'post',
      `${s}/products/${rice.id}/stock-movements`,
      { type: 'RECEIVE', quantity: '5' },
      {
        'Idempotency-Key': 'lp-receive-1',
      },
    ).expect(201);
    await call('post', `${s}/products/import`, {
      csv: 'name,unit,selling_price\nSoap,PIECE,30\n',
      dryRun: false,
    }).expect(201);

    const voice = (
      await call('post', `${s}/voice/parse`, { transcript: 'రెండు కిలోల బియ్యం', locale: 'te-IN' }).expect(
        200,
      )
    ).body.result;
    const items = [
      { productId: voice.lines[0].candidates[0].product.id, quantity: voice.lines[0].candidates[0].quantity },
    ];
    const quote = (await call('post', `${s}/sales/quote`, { items }).expect(200)).body.quote;
    expect(quote.totals.grandTotal).toBe('124.00');
    const sale = (
      await call(
        'post',
        `${s}/sales`,
        {
          items,
          payments: [{ method: 'CASH', amount: '124.00', tendered: '200' }],
          expectedGrandTotal: '124.00',
          source: 'VOICE',
        },
        { 'Idempotency-Key': 'lp-sale-1' },
      ).expect(201)
    ).body.sale;
    expect(sale.invoiceNumber).toMatch(/^LK\/\d\d-\d\d\/1$/);
    await call(
      'post',
      `${s}/sales/${sale.id}/returns`,
      {
        items: [{ saleItemId: sale.items[0].id, quantity: '0.5' }],
        reason: 'Spilled',
        refundMethod: 'CASH',
      },
      { 'Idempotency-Key': 'lp-return-1' },
    ).expect(201);

    const receipt = (await call('get', `${s}/sales/${sale.id}/receipt`).expect(200)).body.receipt;
    expect(receipt).toMatchObject({ kind: 'TAX_INVOICE', netTotal: '93.00' });
    const daily = (await call('get', `${s}/reports/daily`).expect(200)).body.summary;
    expect(daily).toMatchObject({ billCount: 1, netSales: '93.00' });
    await call('get', `${s}/reports/low-stock`).expect(200);
    expect((await call('get', `${s}/audit-logs`).expect(200)).body.entries.length).toBeGreaterThan(5);
    await call('get', '/health/ready').expect(200);
    await call('post', '/auth/logout').expect(204);
  });

  it('denies the app role schema changes, migration history and history rewrites', async () => {
    const denied = /permission denied|must be owner|append-only/i;
    for (const sql of [
      'CREATE TABLE "Evil" (id int)',
      'DROP TABLE "Product"',
      'ALTER TABLE "Sale" DISABLE TRIGGER "Sale_append_only"',
      'TRUNCATE "Product" CASCADE',
      'SELECT * FROM "_prisma_migrations"',
      'UPDATE "Sale" SET "grandTotal" = 0',
      // The one column granted (for row locks) is still guarded by the append-only trigger.
      'UPDATE "Sale" SET "id" = "id"',
      'DELETE FROM "AuditLog"',
      'UPDATE "InventoryMovement" SET "quantityDelta" = 1',
      'DELETE FROM "SaleReturnItem"',
    ]) {
      await expect(appDb.$executeRawUnsafe(sql), sql).rejects.toThrow(denied);
    }
    const [timeout] = await appDb.$queryRawUnsafe<{ statement_timeout: string }[]>('SHOW statement_timeout');
    expect(timeout!.statement_timeout).toBe('30s');
    // Ordinary writes the app needs still work.
    await expect(appDb.$executeRawUnsafe(`UPDATE "Product" SET "name" = "name"`)).resolves.toBeGreaterThan(0);
  });
});
