/** `npm run dev:db` — persistent local PostgreSQL on :5433 for development. Ctrl+C to stop. */
import { migrateDeploy, startLocalPg } from './embedded-pg.js';

const password = process.env.DEV_DB_PASSWORD ?? 'devpassword';
const pg = await startLocalPg({
  dataDir: '.pgdata-dev',
  port: 5433,
  database: 'kirana_dev',
  persistent: true,
  password,
});
migrateDeploy(pg.url);
console.log(`Dev PostgreSQL ready. Put this in apps/api/.env:\nDATABASE_URL=${pg.url}`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
