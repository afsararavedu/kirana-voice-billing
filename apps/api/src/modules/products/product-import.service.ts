import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  createProductSchema,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  type CreateProductInput,
  type ImportRowError,
} from '@kirana/shared';
import { CsvError, parse } from 'csv-parse/sync';
import { dec } from '../../lib/decimal.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { buildAliasRows } from './product.mapper.js';
import { isSkuConflict, skuTaken } from './product.service.js';

const REQUIRED = ['name', 'unit', 'selling_price'] as const;
const FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name',
  unit: 'unit',
  sellingPrice: 'selling_price',
  taxRate: 'tax_rate',
  priceIncludesTax: 'price_includes_tax',
  sku: 'sku',
  openingStock: 'opening_stock',
  lowStockThreshold: 'low_stock_threshold',
  'localNames.hi': 'name_hi',
  'localNames.te': 'name_te',
  'localNames.ur': 'name_ur',
  aliases: 'aliases',
};
const MAX_REPORTED_ERRORS = 200;
const IMPORT_TX_TIMEOUT_MS = 60_000;

type Row = Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>;

function parseBool(v: string | undefined): boolean | string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return v; // fails schema validation with a useful message
}

function toCandidate(r: Row): unknown {
  const localNames = Object.fromEntries(
    (['hi', 'te', 'ur'] as const).flatMap((l) => (r[`name_${l}`] ? [[l, r[`name_${l}`]]] : [])),
  );
  return {
    name: r.name ?? '',
    unit: r.unit?.toUpperCase() ?? '',
    sellingPrice: r.selling_price ?? '',
    taxRate: r.tax_rate || undefined,
    priceIncludesTax: parseBool(r.price_includes_tax),
    sku: r.sku || null,
    openingStock: r.opening_stock || undefined,
    lowStockThreshold: r.low_stock_threshold || null,
    localNames,
    aliases: (r.aliases ?? '')
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean),
  };
}

export interface ImportResult {
  valid: number;
  imported: number;
  errors: ImportRowError[];
  totalErrors: number;
}

export class ProductImportService {
  constructor(private readonly db: PrismaClient) {}

  /** Validates every row first; writes all rows in one transaction or none at all. */
  async run(storeId: string, actorUserId: string, csv: string, dryRun: boolean): Promise<ImportResult> {
    const rows = this.parseCsv(csv);
    const errors: ImportRowError[] = [];
    const valid: { line: number; input: CreateProductInput }[] = [];

    rows.forEach((r, i) => {
      const line = i + 2; // 1-based, header is line 1
      const parsed = createProductSchema.safeParse(toCandidate(r));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.join('.');
          errors.push({ row: line, field: FIELD_TO_COLUMN[path] ?? path, message: issue.message });
        }
      } else {
        valid.push({ line, input: parsed.data });
      }
    });

    // SKU uniqueness: within the file and against this store's existing catalog.
    const seen = new Map<string, number>();
    for (const { line, input } of valid) {
      if (!input.sku) continue;
      const first = seen.get(input.sku);
      if (first) errors.push({ row: line, field: 'sku', message: `Duplicate of row ${first}` });
      else seen.set(input.sku, line);
    }
    if (seen.size > 0) {
      const existing = await this.db.product.findMany({
        where: { storeId, sku: { in: [...seen.keys()] } },
        select: { sku: true },
      });
      for (const { sku } of existing) {
        errors.push({
          row: seen.get(sku!)!,
          field: 'sku',
          message: 'Already used by a product in this store',
        });
      }
    }

    errors.sort((a, b) => a.row - b.row);
    const result = (imported: number): ImportResult => ({
      valid: errors.length ? valid.length - new Set(errors.map((e) => e.row)).size : valid.length,
      imported,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      totalErrors: errors.length,
    });

    if (dryRun) return result(0);
    if (errors.length > 0) {
      throw new AppError(422, 'IMPORT_INVALID', 'Some rows are invalid; nothing was imported', result(0));
    }

    try {
      await this.db.$transaction(
        async (tx) => {
          const products: Prisma.ProductCreateManyInput[] = [];
          const aliases: Prisma.ProductAliasCreateManyInput[] = [];
          const movements: Prisma.InventoryMovementCreateManyInput[] = [];
          for (const { input } of valid) {
            const id = randomUUID();
            const opening = dec(input.openingStock);
            products.push({
              id,
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
            });
            aliases.push(...buildAliasRows(storeId, id, input));
            if (opening.gt(0)) {
              movements.push({
                storeId,
                productId: id,
                type: 'OPENING',
                quantityDelta: opening,
                balanceAfter: opening,
                actorUserId,
                note: 'CSV import',
              });
            }
          }
          await tx.product.createMany({ data: products });
          await tx.productAlias.createMany({ data: aliases });
          if (movements.length) await tx.inventoryMovement.createMany({ data: movements });
          await recordAudit(tx, {
            storeId,
            actorUserId,
            action: 'product.imported',
            entityType: 'Product',
            metadata: { count: products.length, withOpeningStock: movements.length },
          });
        },
        { timeout: IMPORT_TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (isSkuConflict(e)) throw skuTaken();
      throw e;
    }
    return result(valid.length);
  }

  private parseCsv(csv: string): Row[] {
    let header: string[] = [];
    let records: Row[];
    try {
      records = parse(csv, {
        bom: true,
        trim: true,
        skip_empty_lines: true,
        to_line: IMPORT_MAX_ROWS + 2,
        columns: (h: string[]) => (header = h.map((c) => c.trim().toLowerCase())),
      }) as Row[];
    } catch (e) {
      if (e instanceof CsvError) {
        throw new AppError(422, 'IMPORT_PARSE_ERROR', 'The file is not valid CSV', {
          line: (e as CsvError & { lines?: number }).lines ?? null,
        });
      }
      throw e;
    }

    const unknown = header.filter((c) => !(IMPORT_COLUMNS as readonly string[]).includes(c));
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (unknown.length || missing.length) {
      throw new AppError(422, 'IMPORT_INVALID_HEADER', 'Unexpected CSV columns', {
        missing,
        unknown,
        expected: IMPORT_COLUMNS,
      });
    }
    if (records.length > IMPORT_MAX_ROWS) {
      throw new AppError(422, 'IMPORT_TOO_MANY_ROWS', `At most ${IMPORT_MAX_ROWS} rows per import`);
    }
    if (records.length === 0) throw new AppError(422, 'IMPORT_EMPTY', 'The file has no product rows');
    return records;
  }
}
