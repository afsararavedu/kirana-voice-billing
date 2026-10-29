/** `npm run smoke:dist` — boots the compiled production build against a throwaway DB and checks readiness. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { API_ROOT, migrateDeploy, startLocalPg } from './embedded-pg.js';

const pg = await startLocalPg({
  dataDir: '.pgdata-smoke',
  port: 54331,
  database: 'kirana_smoke',
  persistent: false,
});
migrateDeploy(pg.url);

const child = spawn(process.execPath, [resolve(API_ROOT, 'dist/server.js')], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '4200',
    DATABASE_URL: pg.url,
    WEB_ORIGINS: 'https://example.invalid',
    LOG_LEVEL: 'warn',
  },
  stdio: 'inherit',
});

let ok = false;
for (let i = 0; i < 30 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch('http://localhost:4200/api/v1/health/ready');
    ok = res.ok && ((await res.json()) as { database?: string }).database === 'ok';
  } catch {
    // not up yet
  }
}

child.kill('SIGTERM');
await pg.stop();
console.log(ok ? 'dist smoke: ready OK' : 'dist smoke: FAILED');
process.exit(ok ? 0 : 1);
