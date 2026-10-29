import { Prisma, type PrismaClient } from '@prisma/client';
import {
  isQuantityValidForUnit,
  normalizeTerm,
  type CreateProductInput,
  type ProductDto,
  type UpdateProductInput,
} from '@kirana/shared';
import { dec, moneyStr, qtyStr } from '../../lib/decimal.js';
import { AppError, notFound } from '../../lib/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  buildAliasRows,
  extraAliases,
  readLocalNames,
  toMovementDto,
  toProductDto,
  withAliases,
  type ProductWithAliases,
} from './product.mapper.js';

export const skuTaken = () => new AppError(409, 'SKU_TAKEN', 'Another product in this store uses that SKU');

export function isSkuConflict(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    JSON.stringify(e.meta?.target ?? '').includes('sku')
  );
}

/** Serialises a field value for audit metadata (Decimals as canonical strings). */
function auditValue(field: string, v: unknown): unknown {
  if (v instanceof Prisma.Decimal) return field === 'lowStockThreshold' ? qtyStr(v) : moneyStr(v);
  return v ?? null;
}

/** All queries take `storeId` from `req.tenant` and include it in every WHERE clause. */
export class ProductService {
  constructor(private readonly db: PrismaClient) {}

  async list(
    storeId: string,
    opts: { q?: string; includeInactive: boolean; limit: number; cursor?: string },
  ): Promise<{ products: ProductDto[]; nextCursor: string | null }> {
    const term = opts.q ? normalizeTerm(opts.q) : '';
    const rows = await this.db.product.findMany({
      where: {
        storeId,
        ...(opts.includeInactive ? {} : { isActive: true }),
        ...(term ? { aliases: { some: { storeId, normalized: { contains: term } } } } : {}),
      },
      include: withAliases,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, opts.limit);
    return {
      products: page.map(toProductDto),
      nextCursor: rows.length > opts.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(storeId: string, productId: string): Promise<ProductDto> {
    const p = await this.db.product.findFirst({ where: { id: productId, storeId }, include: withAliases });
    if (!p) throw notFound('Product');
    return toProductDto(p);
  }

  async create(storeId: string, actorUserId: string, input: CreateProductInput): Promise<ProductDto> {
    const opening = dec(input.openingStock);
    try {
      const product = await this.db.$transaction(async (tx) => {
        const p = await tx.product.create({
          data: {
            storeId,
            name: input.name,
            localNames: input.localNames,
            sku: input.sku,
            unit: input.unit,
            sellingPrice: input.sellingPrice,
            taxRate: input.taxRate,
            priceIncludesTax: input.priceIncludesTax,
            stockQuantity: opening,
            lowStockThreshold: input.lowStockThreshold,
          },
        });
        await tx.productAlias.createMany({ data: buildAliasRows(storeId, p.id, input) });
        if (opening.gt(0)) {
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: p.id,
              type: 'OPENING',
              quantityDelta: opening,
              balanceAfter: opening,
              actorUserId,
            },
          });
        }
        await recordAudit(tx, {
          storeId,
          actorUserId,
          action: 'product.created',
          entityType: 'Product',
          entityId: p.id,
          metadata: {
            name: p.name,
            unit: p.unit,
            sellingPrice: moneyStr(p.sellingPrice),
            taxRate: moneyStr(p.taxRate),
            openingStock: qtyStr(opening),
          },
        });
        return tx.product.findUniqueOrThrow({ where: { id: p.id }, include: withAliases });
      });
      return toProductDto(product);
    } catch (e) {
      if (isSkuConflict(e)) throw skuTaken();
      throw e;
    }
  }

  async update(
    storeId: string,
    actorUserId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductDto> {
    try {
      const product = await this.db.$transaction(async (tx) => {
        // Lock so the audit's before/after reflects exactly this change.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Product" WHERE "id" = ${productId}::uuid AND "storeId" = ${storeId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw notFound('Product');
        const before: ProductWithAliases = await tx.product.findUniqueOrThrow({
          where: { id: productId },
          include: withAliases,
        });

        if (input.lowStockThreshold && !isQuantityValidForUnit(input.lowStockThreshold, before.unit)) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
            { path: 'lowStockThreshold', message: `Whole numbers only for ${before.unit}` },
          ]);
        }

        const { aliases, ...scalar } = input;
        const after = await tx.product.update({ where: { id: productId }, data: scalar });

        if (input.name !== undefined || input.localNames !== undefined || aliases !== undefined) {
          await tx.productAlias.deleteMany({ where: { storeId, productId } });
          await tx.productAlias.createMany({
            data: buildAliasRows(storeId, productId, {
              name: after.name,
              localNames: readLocalNames(after.localNames),
              aliases: aliases ?? extraAliases(before),
            }),
          });
        }

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const field of Object.keys(scalar) as (keyof typeof scalar)[]) {
          changes[field] = { from: auditValue(field, before[field]), to: auditValue(field, after[field]) };
        }
        if (aliases !== undefined) changes.aliases = { from: extraAliases(before), to: aliases };
        await recordAudit(tx, {
          storeId,
          actorUserId,
          action: 'product.updated',
          entityType: 'Product',
          entityId: productId,
          metadata: changes as Prisma.InputJsonValue,
        });

        return tx.product.findUniqueOrThrow({ where: { id: productId }, include: withAliases });
      });
      return toProductDto(product);
    } catch (e) {
      if (isSkuConflict(e)) throw skuTaken();
      throw e;
    }
  }

  async listMovements(storeId: string, productId: string, limit: number, beforeSeq?: bigint) {
    const exists = await this.db.product.count({ where: { id: productId, storeId } });
    if (!exists) throw notFound('Product');
    const rows = await this.db.inventoryMovement.findMany({
      where: { storeId, productId, ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}) },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.map(toMovementDto);
  }
}
