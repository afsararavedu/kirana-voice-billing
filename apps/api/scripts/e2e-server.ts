/** Throwaway DB + API on :4100 for Playwright. Started by apps/web/playwright.config.ts. */
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { migrateDeploy, startLocalPg } from './embedded-pg.js';

const pg = await startLocalPg({
  dataDir: '.pgdata-e2e',
  port: 54330,
  database: 'kirana_e2e',
  persistent: false,
});
migrateDeploy(pg.url);

const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '4100',
  DATABASE_URL: pg.url,
  WEB_ORIGINS: 'http://localhost:5174',
  LOG_LEVEL: 'warn',
  // Every Playwright test signs up from the same address; the production limits (covered by the
  // API integration tests) would start refusing them once the suite grows.
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
});
const db = new PrismaClient({ datasourceUrl: config.databaseUrl });
const server = createApp({ config, db, logger: createLogger(config.logLevel) }).listen(config.port, () =>
  console.log(`e2e api on :${config.port}`),
);

const stop = async () => {
  server.close();
  await db.$disconnect();
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
