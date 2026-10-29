import { z } from 'zod';
import { UI_LANGUAGES } from './languages.js';

export const UNITS = ['KG', 'G', 'L', 'ML', 'PIECE', 'PACK', 'DOZEN'] as const;
export type Unit = (typeof UNITS)[number];

/** Weight/volume units may hold up to 3 decimals; countable units must be whole numbers. */
export const FRACTIONAL_UNITS: ReadonlySet<Unit> = new Set<Unit>(['KG', 'G', 'L', 'ML']);

/** Common GST slabs offered in the UI; any 0–100 rate with 2 decimals is accepted. */
export const GST_SLABS = ['0', '5', '12', '18', '28'] as const;

// Decimals travel as strings so no value ever passes through a binary float.
// Limits match the DB columns: money Decimal(12,2), quantity Decimal(12,3), tax Decimal(5,2).
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Expected an amount like 12 or 12.50');
export const quantityString = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Expected a quantity like 2 or 1.250');
export const signedQuantityString = z
  .string()
  .trim()
  .regex(/^-?\d{1,9}(\.\d{1,3})?$/, 'Expected a quantity like -2 or 1.250')
  .refine((v) => !/^-?0+(\.0+)?$/.test(v), 'Must not be zero');
export const taxRateString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Expected a rate like 5 or 12.5')
  .refine((v) => Number(v) <= 100, 'Must be at most 100'); // range check only, not arithmetic

/** True when `qty` (a validated decimal string) is allowed for `unit`. */
export function isQuantityValidForUnit(qty: string, unit: Unit): boolean {
  if (FRACTIONAL_UNITS.has(unit)) return true;
  const [, frac = ''] = qty.replace(/^-/, '').split('.');
  return /^0*$/.test(frac);
}

/**
 * Normalises names for matching across scripts: NFKC, strip zero-width joiners, lowercase,
 * punctuation/symbols to spaces, collapse whitespace. Shared with Phase 5 voice matching.
 */
export function normalizeTerm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const productName = z.string().trim().min(1).max(120);
const localNames = z
  .object(
    Object.fromEntries(UI_LANGUAGES.map((l) => [l, productName.optional()])) as Record<
      (typeof UI_LANGUAGES)[number],
      z.ZodOptional<typeof productName>
    >,
  )
  .strict();
export type LocalNames = z.infer<typeof localNames>;

const aliases = z.array(productName).max(20);
const sku = z.string().trim().min(1).max(64).nullable();

function checkUnitQuantities(
  v: { unit?: Unit; openingStock?: string; lowStockThreshold?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!v.unit) return;
  for (const field of ['openingStock', 'lowStockThreshold'] as const) {
    const q = v[field];
    if (q && !isQuantityValidForUnit(q, v.unit)) {
      ctx.addIssue({ code: 'custom', path: [field], message: `Whole numbers only for ${v.unit}` });
    }
  }
}

export const createProductSchema = z
  .object({
    name: productName,
    localNames: localNames.default({}),
    aliases: aliases.default([]),
    sku: sku.optional().default(null),
    unit: z.enum(UNITS),
    sellingPrice: moneyString,
    taxRate: taxRateString.default('0'),
    priceIncludesTax: z.boolean().default(true),
    openingStock: quantityString.default('0'),
    lowStockThreshold: quantityString.nullable().default(null),
  })
  .superRefine(checkUnitQuantities);
export type CreateProductInput = z.infer<typeof createProductSchema>;
/** What a client sends (defaults not yet applied). */
export type CreateProductRequest = z.input<typeof createProductSchema>;

/** Unit is immutable after creation: changing it would reinterpret every ledger entry. */
export const updateProductSchema = z
  .object({
    name: productName,
    localNames,
    aliases,
    sku,
    sellingPrice: moneyString,
    taxRate: taxRateString,
    priceIncludesTax: z.boolean(),
    lowStockThreshold: quantityString.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

const note = z.string().trim().min(1).max(255);

export const stockMovementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RECEIVE'), quantity: quantityString, note: note.optional() }),
  z.object({ type: z.literal('DAMAGE'), quantity: quantityString, note: note.optional() }),
  z.object({ type: z.literal('EXPIRY'), quantity: quantityString, note: note.optional() }),
  /** Correction by a signed amount; a reason is mandatory. */
  z.object({ type: z.literal('ADJUST'), quantityDelta: signedQuantityString, note }),
  /** Physical count: server records a COUNT movement for the difference from the books. */
  z.object({ type: z.literal('COUNT'), countedQuantity: quantityString, note: note.optional() }),
]);
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export const STOCK_MOVEMENT_KINDS = ['RECEIVE', 'DAMAGE', 'EXPIRY', 'ADJUST', 'COUNT'] as const;

export const productListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  includeInactive: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export const IMPORT_MAX_ROWS = 2000;
export const importProductsSchema = z.object({
  csv: z.string().min(1).max(1_500_000),
  dryRun: z.boolean().default(false),
});
export const IMPORT_COLUMNS = [
  'name',
  'unit',
  'selling_price',
  'tax_rate',
  'price_includes_tax',
  'sku',
  'opening_stock',
  'low_stock_threshold',
  'name_hi',
  'name_te',
  'name_ur',
  'aliases',
] as const;

export const MOVEMENT_TYPES = [
  'OPENING',
  'RECEIVE',
  'ADJUST',
  'COUNT',
  'DAMAGE',
  'EXPIRY',
  'SALE',
  'RETURN',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface ProductDto {
  id: string;
  name: string;
  localNames: LocalNames;
  aliases: string[];
  sku: string | null;
  unit: Unit;
  sellingPrice: string;
  taxRate: string;
  priceIncludesTax: boolean;
  stockQuantity: string;
  lowStockThreshold: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementDto {
  id: string;
  seq: string;
  type: MovementType;
  quantityDelta: string;
  balanceAfter: string;
  note: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}
