import {
  createProductSchema,
  importProductsSchema,
  productListQuerySchema,
  stockMovementSchema,
  updateProductSchema,
  uuidParam,
} from '@kirana/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { requireRole } from '../../middleware/auth.js';
import { idempotencyContext } from '../idempotency/idempotency.js';
import { MOVEMENT_SCOPE, type InventoryService } from './inventory.service.js';
import type { ProductImportService } from './product-import.service.js';
import type { ProductService } from './product.service.js';

const movementsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  beforeSeq: z
    .string()
    .regex(/^\d{1,18}$/)
    .transform((s) => BigInt(s))
    .optional(),
});

function productIdOf(req: Request): string {
  const parsed = uuidParam.safeParse(req.params.productId);
  if (!parsed.success) throw notFound('Product');
  return parsed.data;
}

/** Mounted under `/stores/:storeId/products`, after `requireStoreMember` has set `req.tenant`. */
export function productRouter(
  products: ProductService,
  inventory: InventoryService,
  importer: ProductImportService,
): Router {
  const r = Router({ mergeParams: true });
  const canManage = requireRole('OWNER', 'MANAGER');

  r.get('/', async (req, res) => {
    const q = productListQuerySchema.parse(req.query);
    const result = await products.list(req.tenant!.storeId, {
      ...q,
      includeInactive: q.includeInactive === 'true',
    });
    res.json(result);
  });

  r.post('/', canManage, async (req, res) => {
    const input = createProductSchema.parse(req.body);
    const product = await products.create(req.tenant!.storeId, req.auth!.user.id, input);
    res.status(201).json({ product });
  });

  r.post('/import', canManage, async (req, res) => {
    const { csv, dryRun } = importProductsSchema.parse(req.body);
    const result = await importer.run(req.tenant!.storeId, req.auth!.user.id, csv, dryRun);
    res.status(dryRun ? 200 : 201).json(result);
  });

  r.get('/:productId', async (req, res) => {
    res.json({ product: await products.get(req.tenant!.storeId, productIdOf(req)) });
  });

  r.patch('/:productId', canManage, async (req, res) => {
    const input = updateProductSchema.parse(req.body);
    const product = await products.update(req.tenant!.storeId, req.auth!.user.id, productIdOf(req), input);
    res.json({ product });
  });

  r.get('/:productId/stock-movements', async (req, res) => {
    const { limit, beforeSeq } = movementsQuery.parse(req.query);
    const movements = await products.listMovements(req.tenant!.storeId, productIdOf(req), limit, beforeSeq);
    res.json({ movements });
  });

  r.post('/:productId/stock-movements', canManage, async (req, res) => {
    const productId = productIdOf(req);
    const input = stockMovementSchema.parse(req.body);
    const storeId = req.tenant!.storeId;
    const idem = idempotencyContext(req, storeId, MOVEMENT_SCOPE, { productId, input });
    const result = await inventory.recordMovement(storeId, req.auth!.user.id, productId, input, idem);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  return r;
}
