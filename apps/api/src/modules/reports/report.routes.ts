import { dailyReportQuerySchema } from '@kirana/shared';
import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import type { ReportService } from './report.service.js';

/** Mounted under `/stores/:storeId/reports`, after `requireStoreMember` has set `req.tenant`. */
export function reportRouter(reports: ReportService): Router {
  const r = Router({ mergeParams: true });

  // Takings are for owners and managers; cashiers see only their own bills at the counter.
  r.get('/daily', requireRole('OWNER', 'MANAGER'), async (req, res) => {
    const { date } = dailyReportQuerySchema.parse(req.query);
    res.json({ summary: await reports.daily(req.tenant!.storeId, date) });
  });

  // Everyone restocks shelves, so every member may see what is running out.
  r.get('/low-stock', async (req, res) => {
    res.json({ items: await reports.lowStock(req.tenant!.storeId) });
  });

  return r;
}
