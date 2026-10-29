import type { PrismaClient, Store } from '@prisma/client';
import { fiscalYearOf, type CreateStoreInput, type UpdateStoreInput } from '@kirana/shared';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { StoreRepository } from './store.repository.js';

export class StoreService {
  constructor(private readonly db: PrismaClient) {}

  /** Store, owner membership and audit row commit together or not at all. */
  create(ownerId: string, input: CreateStoreInput): Promise<Store> {
    return this.db.$transaction(async (tx) => {
      const store = await StoreRepository.createWithOwner(tx, ownerId, input);
      await recordAudit(tx, {
        storeId: store.id,
        actorUserId: ownerId,
        action: 'store.created',
        entityType: 'Store',
        entityId: store.id,
        metadata: { name: store.name },
      });
      return store;
    });
  }

  /** `storeId` must come from `req.tenant`, which is derived from server-side membership. */
  update(actorUserId: string, storeId: string, input: UpdateStoreInput): Promise<Store> {
    return this.db.$transaction(async (tx) => {
      // Same lock finalize takes, so a prefix change cannot interleave with a bill being numbered.
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId}::uuid FOR UPDATE`;
      const before = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
      if (input.invoicePrefix !== undefined && input.invoicePrefix !== before.invoicePrefix) {
        const issued = await tx.invoiceCounter.count({
          where: { storeId, fiscalYear: fiscalYearOf(new Date()) },
        });
        // One consecutive series per financial year: the prefix may change only before its first bill.
        if (issued > 0) {
          throw new AppError(
            409,
            'INVOICE_PREFIX_LOCKED',
            'The invoice prefix can only change before the first bill of the financial year',
          );
        }
      }
      const after = await tx.store.update({ where: { id: storeId }, data: input });
      const changes = Object.fromEntries(
        (Object.keys(input) as (keyof UpdateStoreInput)[]).map((k) => [k, { from: before[k], to: after[k] }]),
      );
      await recordAudit(tx, {
        storeId,
        actorUserId,
        action: 'store.updated',
        entityType: 'Store',
        entityId: storeId,
        metadata: changes,
      });
      return after;
    });
  }
}
