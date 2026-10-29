import type { Prisma, PrismaClient, Store, StoreMembership, StoreRole } from '@prisma/client';
import type { AuditEntryDto, StoreDto } from '@kirana/shared';

export type MembershipWithStore = StoreMembership & { store: Store };

/** Every query is keyed by the authenticated user's membership or by a tenant storeId from `req.tenant`. */
export class StoreRepository {
  constructor(private readonly db: PrismaClient) {}

  findMembership(userId: string, storeId: string): Promise<StoreMembership | null> {
    return this.db.storeMembership.findUnique({ where: { userId_storeId: { userId, storeId } } });
  }

  listForUser(userId: string): Promise<MembershipWithStore[]> {
    return this.db.storeMembership.findMany({
      where: { userId },
      include: { store: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  getForMember(userId: string, storeId: string): Promise<MembershipWithStore | null> {
    return this.db.storeMembership.findUnique({
      where: { userId_storeId: { userId, storeId } },
      include: { store: true },
    });
  }

  /** Newest first; `before` is the id of the last entry of the previous page. */
  async listAudit(
    storeId: string,
    opts: { limit: number; before?: string; entityType?: string },
  ): Promise<{ entries: AuditEntryDto[]; nextBefore: string | null }> {
    const where = { storeId, ...(opts.entityType ? { entityType: opts.entityType } : {}) };
    // The cursor must itself belong to this store and filter, or paging could leak or loop.
    if (opts.before && !(await this.db.auditLog.count({ where: { ...where, id: opts.before } }))) {
      return { entries: [], nextBefore: null };
    }
    const rows = await this.db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
      include: { actor: { select: { id: true, displayName: true } } },
    });
    const page = rows.slice(0, opts.limit);
    return {
      entries: page.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        actor: e.actor,
        metadata:
          e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata) ? e.metadata : {},
        createdAt: e.createdAt.toISOString(),
      })),
      nextBefore: rows.length > opts.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  static createWithOwner(
    tx: Prisma.TransactionClient,
    ownerId: string,
    data: Prisma.StoreCreateWithoutMembershipsInput,
  ) {
    return tx.store.create({
      data: { ...data, memberships: { create: { userId: ownerId, role: 'OWNER' } } },
    });
  }
}

export function toStoreDto(store: Store, role: StoreRole): StoreDto {
  return {
    id: store.id,
    name: store.name,
    currency: store.currency,
    receiptLanguage: store.receiptLanguage,
    address: store.address,
    phone: store.phone,
    gstin: store.gstin,
    invoicePrefix: store.invoicePrefix,
    receiptFooter: store.receiptFooter,
    role,
    createdAt: store.createdAt.toISOString(),
  };
}
