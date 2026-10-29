/**
 * Local-only PostgreSQL for dev, integration tests and e2e on machines without Docker/PostgreSQL.
 * Runs the real PostgreSQL server binaries (npm `embedded-postgres`). Never used in production.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

export const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface LocalPg {
  url: string;
  stop: () => Promise<void>;
}

export async function startLocalPg(opts: {
  dataDir: string;
  port: number;
  database: string;
  persistent: boolean;
  password?: string;
}): Promise<LocalPg> {
  const dataDir = resolve(API_ROOT, opts.dataDir);
  const password = opts.password ?? randomBytes(12).toString('hex');
  if (!opts.persistent) removeDataDir(dataDir);
  const fresh = !existsSync(dataDir);

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password,
    port: opts.port,
    // We delete throwaway data dirs ourselves: the library's delete-on-stop races Windows still
    // holding the files of the just-stopped server (EBUSY), failing an otherwise green run.
    persistent: true,
    // Windows initdb otherwise defaults to WIN1252, which cannot store Telugu/Hindi/Urdu text.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
  });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase(opts.database);

  return {
    url: `postgresql://postgres:${password}@localhost:${opts.port}/${opts.database}?schema=public`,
    stop: async () => {
      await pg.stop();
      if (!opts.persistent) {
        try {
          removeDataDir(dataDir);
        } catch {
          // Still locked: the next start removes it before initialising.
        }
      }
    },
  };
}

function removeDataDir(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Applies committed migrations exactly as production would (`prisma migrate deploy`). */
export function migrateDeploy(databaseUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
