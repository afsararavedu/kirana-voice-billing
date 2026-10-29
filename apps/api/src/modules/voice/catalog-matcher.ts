import type { Prisma, PrismaClient, Product } from '@prisma/client';
import {
  isQuantityValidForUnit,
  normalizeTerm,
  type ExtractedItem,
  type Unit,
  type VoiceCandidateDto,
  type VoiceLineDto,
} from '@kirana/shared';
import { dec, type Decimal } from '../../lib/decimal.js';
import { readLocalNames } from '../products/product.mapper.js';

export const MAX_CANDIDATES = 5;

/** Spoken unit → product unit factors. Anything not listed (e.g. PACK vs PIECE) cannot convert. */
const CONVERSIONS: Partial<Record<Unit, Partial<Record<Unit, string>>>> = {
  G: { KG: '0.001' },
  KG: { G: '1000' },
  ML: { L: '0.001' },
  L: { ML: '1000' },
  DOZEN: { PIECE: '12' },
};

/**
 * Quantity in the product's own unit, or why it cannot go into the cart as heard. Exact decimal
 * arithmetic; the result must fit the cart's rules (≤ 3 decimals, whole numbers for countables).
 */
export function resolveQuantity(
  item: Pick<ExtractedItem, 'quantity' | 'unit'>,
  productUnit: Unit,
): Pick<VoiceCandidateDto, 'quantity' | 'problem'> {
  if (item.quantity === null) return { quantity: null, problem: 'NEEDS_QUANTITY' };
  let q: Decimal = dec(item.quantity);
  if (item.unit && item.unit !== productUnit) {
    const factor = CONVERSIONS[item.unit]?.[productUnit];
    if (!factor) return { quantity: null, problem: 'UNIT_MISMATCH' };
    q = q.times(factor);
  }
  const s = q.toFixed();
  if (q.lte(0) || !q.toDecimalPlaces(3).equals(q) || !/^\d{1,9}(\.\d{1,3})?$/.test(s)) {
    return { quantity: null, problem: 'INVALID_QUANTITY' };
  }
  if (!isQuantityValidForUnit(s, productUnit)) return { quantity: null, problem: 'INVALID_QUANTITY' };
  return { quantity: s, problem: null };
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Active products of this store whose names/aliases match the spoken name. Exact alias matches
 * win; otherwise an alias containing the term or contained in it ("eggs" ↔ "egg"). Every query is
 * scoped by `storeId` from `req.tenant`, so another store's catalog can never match.
 */
export async function findProducts(db: Db, storeId: string, spoken: string): Promise<Product[]> {
  const term = normalizeTerm(spoken);
  if (!term) return [];
  const exact = await db.$queryRaw<{ productId: string }[]>`
    SELECT DISTINCT a."productId" FROM "ProductAlias" a
    JOIN "Product" p ON p."id" = a."productId" AND p."storeId" = a."storeId"
    WHERE a."storeId" = ${storeId}::uuid AND p."isActive" AND a."normalized" = ${term}
    LIMIT ${MAX_CANDIDATES + 1}`;
  const ids = exact.length
    ? exact
    : await db.$queryRaw<{ productId: string }[]>`
        SELECT DISTINCT a."productId" FROM "ProductAlias" a
        JOIN "Product" p ON p."id" = a."productId" AND p."storeId" = a."storeId"
        WHERE a."storeId" = ${storeId}::uuid AND p."isActive"
          AND ((char_length(${term}) >= 2 AND position(${term} in a."normalized") > 0)
            OR (char_length(a."normalized") >= 3 AND position(a."normalized" in ${term}) > 0))
        LIMIT ${MAX_CANDIDATES + 1}`;
  if (ids.length === 0) return [];
  return db.product.findMany({
    where: { storeId, isActive: true, id: { in: ids.map((r) => r.productId) } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_CANDIDATES,
  });
}

export function toVoiceLine(item: ExtractedItem, products: Product[]): VoiceLineDto {
  const candidates: VoiceCandidateDto[] = products.map((p) => ({
    product: { id: p.id, name: p.name, localNames: readLocalNames(p.localNames), unit: p.unit },
    ...resolveQuantity(item, p.unit),
  }));
  const status =
    candidates.length === 0
      ? 'NOT_FOUND'
      : candidates.length > 1
        ? 'AMBIGUOUS'
        : (candidates[0]!.problem ?? 'MATCHED');
  return { heard: item.name, quantity: item.quantity, unit: item.unit, status, candidates };
}
