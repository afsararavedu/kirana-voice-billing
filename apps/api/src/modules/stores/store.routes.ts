import { auditQuerySchema, createStoreSchema, updateStoreSchema } from '@kirana/shared';
import { Router } from 'express';
import { notFound } from '../../lib/errors.js';
import { requireAuth, requireRole, requireStoreMember } from '../../middleware/auth.js';
import { toStoreDto, type StoreRepository } from './store.repository.js';
import type { StoreService } from './store.service.js';

/** `tenantRoutes` mounts feature routers on the tenant-scoped `/stores/:storeId` router. */
export function storeRouter(
  stores: StoreRepository,
  service: StoreService,
  tenantRoutes?: (tenant: Router) => void,
): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req, res) => {
    const memberships = await stores.listForUser(req.auth!.user.id);
    res.json({ stores: memberships.map((m) => toStoreDto(m.store, m.role)) });
  });

  r.post('/', async (req, res) => {
    const input = createStoreSchema.parse(req.body);
    const store = await service.create(req.auth!.user.id, input);
    res.status(201).json({ store: toStoreDto(store, 'OWNER') });
  });

  // Everything below is tenant-scoped.
  const tenant = Router({ mergeParams: true });
  tenant.use(requireStoreMember(stores));

  tenant.get('/', async (req, res) => {
    const m = await stores.getForMember(req.auth!.user.id, req.tenant!.storeId);
    if (!m) throw notFound('Store');
    res.json({ store: toStoreDto(m.store, m.role) });
  });

  tenant.patch('/', requireRole('OWNER'), async (req, res) => {
    const input = updateStoreSchema.parse(req.body);
    const store = await service.update(req.auth!.user.id, req.tenant!.storeId, input);
    res.json({ store: toStoreDto(store, req.tenant!.role) });
  });

  tenant.get('/audit-logs', requireRole('OWNER', 'MANAGER'), async (req, res) => {
    res.json(await stores.listAudit(req.tenant!.storeId, auditQuerySchema.parse(req.query)));
  });

  if (tenantRoutes) tenantRoutes(tenant);

  r.use('/:storeId', tenant);
  return r;
}
