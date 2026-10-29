import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

const DB_CHECK_TIMEOUT_MS = 2_000;

export function healthRouter(db: PrismaClient): Router {
  const r = Router();

  /** Liveness: the process is up. */
  r.get('/', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /** Readiness: the database answers within the timeout. */
  r.get('/ready', async (req, res) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('db check timed out')), DB_CHECK_TIMEOUT_MS);
        }),
      ]);
      res.json({ status: 'ok', database: 'ok' });
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable', database: 'unreachable' });
    } finally {
      clearTimeout(timer);
    }
  });

  return r;
}
