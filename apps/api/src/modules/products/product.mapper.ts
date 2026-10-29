import type { InventoryMovement, Prisma, Product, ProductAlias, UiLanguage } from '@prisma/client';
import {
  normalizeTerm,
  UI_LANGUAGES,
  type LocalNames,
  type ProductDto,
  type StockMovementDto,
} from '@kirana/shared';
import { moneyStr, qtyStr } from '../../lib/decimal.js';

export type ProductWithAliases = Product & { aliases: ProductAlias[] };

/** Prisma `include` that loads aliases in the order they were entered. */
export const withAliases = { aliases: { orderBy: { position: 'asc' } } } satisfies Prisma.ProductInclude;

export function readLocalNames(json: Prisma.JsonValue): LocalNames {
  const out: LocalNames = {};
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const lang of UI_LANGUAGES) {
      const v = (json as Record<string, unknown>)[lang];
      if (typeof v === 'string' && v.length > 0) out[lang] = v;
    }
  }
  return out;
}

/** Aliases the user typed, i.e. excluding the canonical name and the per-language names. */
export function extraAliases(p: ProductWithAliases): string[] {
  const derived = new Set([p.name, ...Object.values(readLocalNames(p.localNames))].map(normalizeTerm));
  return p.aliases.filter((a) => !derived.has(a.normalized)).map((a) => a.text);
}

/** Every searchable name for a product, deduplicated by normalised form. First occurrence wins. */
export function buildAliasRows(
  storeId: string,
  productId: string,
  names: { name: string; localNames: LocalNames; aliases: string[] },
): Prisma.ProductAliasCreateManyInput[] {
  const seen = new Set<string>();
  const rows: Prisma.ProductAliasCreateManyInput[] = [];
  const add = (text: string, language: UiLanguage | null) => {
    const normalized = normalizeTerm(text).slice(0, 120);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    rows.push({ storeId, productId, text, normalized, language, position: rows.length });
  };
  add(names.name, null);
  for (const lang of UI_LANGUAGES) {
    const v = names.localNames[lang];
    if (v) add(v, lang);
  }
  for (const a of names.aliases) add(a, null);
  return rows;
}

export function toProductDto(p: ProductWithAliases): ProductDto {
  return {
    id: p.id,
    name: p.name,
    localNames: readLocalNames(p.localNames),
    aliases: extraAliases(p),
    sku: p.sku,
    unit: p.unit,
    sellingPrice: moneyStr(p.sellingPrice),
    taxRate: moneyStr(p.taxRate),
    priceIncludesTax: p.priceIncludesTax,
    stockQuantity: qtyStr(p.stockQuantity),
    lowStockThreshold: p.lowStockThreshold === null ? null : qtyStr(p.lowStockThreshold),
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toMovementDto(m: InventoryMovement): StockMovementDto {
  return {
    id: m.id,
    seq: m.seq.toString(),
    type: m.type,
    quantityDelta: qtyStr(m.quantityDelta),
    balanceAfter: qtyStr(m.balanceAfter),
    note: m.note,
    actorUserId: m.actorUserId,
    createdAt: m.createdAt.toISOString(),
  };
}
