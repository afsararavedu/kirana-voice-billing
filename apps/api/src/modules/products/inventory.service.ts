import type { MovementType, PrismaClient, UnitOfMeasure } from '@prisma/client';
import { isQuantityValidForUnit, type StockMovementInput } from '@kirana/shared';
import { dec, qtyStr, type Decimal } from '../../lib/decimal.js';
import { AppError, notFound } from '../../lib/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  findReplay,
  isUniqueViolation,
  saveResponse,
  type IdempotencyContext,
  type StoredResponse,
} from '../idempotency/idempotency.js';
import { toMovementDto, toProductDto, withAliases } from './product.mapper.js';

export const MOVEMENT_SCOPE = 'stock-movement';

function invalidQty(unit: UnitOfMeasure) {
  return new AppError(400, 'INVALID_QUANTITY_FOR_UNIT', `Whole numbers only for ${unit}`);
}

/** Translates a request into a signed ledger delta given the current (locked) balance. */
function planMovement(
  input: StockMovementInput,
  current: Decimal,
  unit: UnitOfMeasure,
): { type: MovementType; delta: Decimal; note: string | null } {
  const qtyOf = (s: string) => {
    if (!isQuantityValidForUnit(s, unit)) throw invalidQty(unit);
    return dec(s);
  };
  const positive = (s: string) => {
    const q = qtyOf(s);
    if (q.isZero())
      throw new AppError(400, 'QUANTITY_MUST_BE_POSITIVE', 'Quantity must be greater than zero');
    return q;
  };
  switch (input.type) {
    case 'RECEIVE':
      return { type: 'RECEIVE', delta: positive(input.quantity), note: input.note ?? null };
    case 'DAMAGE':
    case 'EXPIRY':
      return { type: input.type, delta: positive(input.quantity).negated(), note: input.note ?? null };
    case 'ADJUST':
      return { type: 'ADJUST', delta: qtyOf(input.quantityDelta), note: input.note };
    case 'COUNT':
      // No generated text: the type says "count" and balanceAfter is the counted quantity,
      // so the UI can render it in any language.
      return { type: 'COUNT', delta: qtyOf(input.countedQuantity).minus(current), note: input.note ?? null };
  }
}

export class InventoryService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Records one stock movement. Row lock → idempotency check → balance check → ledger insert +
   * cached balance update + audit + stored response, all in one transaction.
   */
  async recordMovement(
    storeId: string,
    actorUserId: string,
    productId: string,
    input: StockMovementInput,
    idem: IdempotencyContext,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const attempt = () =>
      this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ stockQuantity: Decimal; unit: UnitOfMeasure }[]>`
          SELECT "stockQuantity", "unit" FROM "Product"
          WHERE "id" = ${productId}::uuid AND "storeId" = ${storeId}::uuid
          FOR UPDATE`;
        const row = rows[0];
        if (!row) throw notFound('Product');

        const replay = await findReplay(tx, idem);
        if (replay) return { ...replay, replayed: true };

        const current = dec(row.stockQuantity);
        const { type, delta, note } = planMovement(input, current, row.unit);
        let movementDto = null;

        if (!delta.isZero()) {
          const balanceAfter = current.plus(delta);
          if (balanceAfter.isNegative()) {
            throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this change', {
              available: qtyStr(current),
            });
          }
          await tx.product.update({ where: { id: productId }, data: { stockQuantity: balanceAfter } });
          const movement = await tx.inventoryMovement.create({
            data: { storeId, productId, type, quantityDelta: delta, balanceAfter, note, actorUserId },
          });
          movementDto = toMovementDto(movement);
          await recordAudit(tx, {
            storeId,
            actorUserId,
            action: `stock.${input.type.toLowerCase()}`,
            entityType: 'Product',
            entityId: productId,
            metadata: { movementId: movement.id, delta: qtyStr(delta), balanceAfter: qtyStr(balanceAfter) },
          });
        }

        const product = await tx.product.findUniqueOrThrow({
          where: { id: productId },
          include: withAliases,
        });
        // A count that matches the books changes nothing, but is still a successful, idempotent request.
        const response: StoredResponse = {
          status: movementDto ? 201 : 200,
          body: { movement: movementDto, product: toProductDto(product) },
        };
        await saveResponse(tx, idem, response);
        return { ...response, replayed: false };
      });

    try {
      return await attempt();
    } catch (e) {
      // Two identical retries raced past the replay check; the loser now finds the stored response.
      if (isUniqueViolation(e)) return attempt();
      throw e;
    }
  }
}
