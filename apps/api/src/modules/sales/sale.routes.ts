import {
  createReturnSchema,
  finalizeSaleSchema,
  quoteSaleSchema,
  receiptQuerySchema,
  saleListQuerySchema,
  uuidParam,
  type SaleLineInput,
} from '@kirana/shared';
import { Router, type Request } from 'express';
import { AppError, notFound } from '../../lib/errors.js';
import { requireRole } from '../../middleware/auth.js';
import { idempotencyContext } from '../idempotency/idempotency.js';
import type { SaleService } from './sale.service.js';

export const FINALIZE_SCOPE = 'sale.finalize';
export const RETURN_SCOPE = 'sale.return';

/** Discounts change what the customer pays, so only owners and managers may give them. */
function assertMayDiscount(req: Request, items: SaleLineInput[]) {
  const discounted = items.some((i) => i.discount !== undefined && !/^0+(\.0+)?$/.test(i.discount));
  if (discounted && req.tenant!.role === 'CASHIER') {
    throw new AppError(403, 'DISCOUNT_NOT_ALLOWED', 'Only owners and managers can give discounts');
  }
}

function saleIdOf(req: Request): string {
  const parsed = uuidParam.safeParse(req.params.saleId);
  if (!parsed.success) throw notFound('Sale');
  return parsed.data;
}

/** Mounted under `/stores/:storeId/sales`, after `requireStoreMember` has set `req.tenant`. */
export function saleRouter(sales: SaleService): Router {
  const r = Router({ mergeParams: true });

  r.post('/quote', async (req, res) => {
    const { items } = quoteSaleSchema.parse(req.body);
    assertMayDiscount(req, items);
    res.json({ quote: await sales.quote(req.tenant!.storeId, items) });
  });

  // Every member can bill: cashiers are the main users of the counter.
  r.post('/', async (req, res) => {
    const input = finalizeSaleSchema.parse(req.body);
    assertMayDiscount(req, input.items);
    const storeId = req.tenant!.storeId;
    const idem = idempotencyContext(req, storeId, FINALIZE_SCOPE, input);
    const result = await sales.finalize(storeId, req.auth!.user.id, input, idem);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  r.get('/', async (req, res) => {
    const q = saleListQuerySchema.parse(req.query);
    res.json(await sales.list(req.tenant!.storeId, q));
  });

  r.get('/:saleId', async (req, res) => {
    res.json({ sale: await sales.get(req.tenant!.storeId, saleIdOf(req)) });
  });

  // Any member may (re)print: the cashier hands the customer the receipt.
  r.get('/:saleId/receipt', async (req, res) => {
    const { lang } = receiptQuerySchema.parse(req.query);
    res.json({ receipt: await sales.receipt(req.tenant!.storeId, saleIdOf(req), lang) });
  });

  r.post('/:saleId/returns', requireRole('OWNER', 'MANAGER'), async (req, res) => {
    const saleId = saleIdOf(req);
    const input = createReturnSchema.parse(req.body);
    const storeId = req.tenant!.storeId;
    const idem = idempotencyContext(req, storeId, RETURN_SCOPE, { saleId, input });
    const result = await sales.createReturn(storeId, req.auth!.user.id, saleId, input, idem);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  return r;
}
