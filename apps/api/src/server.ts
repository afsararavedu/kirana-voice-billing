import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
const db = new PrismaClient({ datasourceUrl: config.databaseUrl });

const server = createApp({ config, db, logger }).listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'api listening');
});

// Bound slow clients; keep-alive shorter than the reverse proxy's upstream timeout.
server.requestTimeout = 30_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 5_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await db.$disconnect();
    clearTimeout(force);
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
