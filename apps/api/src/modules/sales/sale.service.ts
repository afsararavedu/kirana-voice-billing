import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, Product } from '@prisma/client';
import {
  fiscalYearOf,
  formatInvoiceNumber,
  INVOICE_NUMBER_MAX,
  isQuantityValidForUnit,
  type CreateReturnInput,
  type FinalizeSaleInput,
  type QuoteLineDto,
  type SaleDto,
  type SaleLineInput,
  type ReceiptDto,
  type SaleQuoteDto,
  type SaleSummaryDto,
  type SellerDto,
  type UiLanguage,
} from '@kirana/shared';
import type { Decimal } from '../../lib/decimal.js';
import { dec, moneyStr, qtyStr, roundMoney } from '../../lib/decimal.js';
import { AppError, notFound } from '../../lib/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  findReplay,
  isUniqueViolation,
  saveResponse,
  type IdempotencyContext,
  type StoredResponse,
} from '../idempotency/idempotency.js';
import { readLocalNames } from '../products/product.mapper.js';
import { priceLine, PricingError, refundForReturn, sumTotals, type LineAmounts } from './pricing.js';
import { returnedByItem, saleInclude, toReceiptDto, toSaleDto, toSaleSummaryDto } from './sale.mapper.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

interface PricedLine extends LineAmounts {
  product: Product;
  quantity: Decimal;
}

const ZERO = dec('0');

/** Prices every line from the tenant's own catalog. Client-supplied prices do not exist in the API. */
function priceLines(products: Map<string, Product>, items: SaleLineInput[]): PricedLine[] {
  return items.map((item) => {
    const product = products.get(item.productId);
    // Another store's product is indistinguishable from a nonexistent one.
    if (!product)
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found', { productId: item.productId });
    if (!product.isActive) {
      throw new AppError(422, 'PRODUCT_INACTIVE', 'Product is archived', { productId: product.id });
    }
    if (!isQuantityValidForUnit(item.quantity, product.unit)) {
      throw new AppError(400, 'INVALID_QUANTITY_FOR_UNIT', `Whole numbers only for ${product.unit}`, {
        productId: product.id,
      });
    }
    const quantity = dec(item.quantity);
    if (quantity.isZero()) {
      throw new AppError(400, 'QUANTITY_MUST_BE_POSITIVE', 'Quantity must be greater than zero', {
        productId: product.id,
      });
    }
    try {
      return {
        product,
        quantity,
        ...priceLine(product, quantity, item.discount ? dec(item.discount) : ZERO),
      };
    } catch (e) {
      if (e instanceof PricingError) {
        throw new AppError(400, e.code, 'Discount is larger than the line amount', { productId: product.id });
      }
      throw e;
    }
  });
}

/** Requested quantity per product (lines for the same product are summed). */
function requestedByProduct(lines: PricedLine[]): Map<string, { product: Product; qty: Decimal }> {
  const map = new Map<string, { product: Product; qty: Decimal }>();
  for (const l of lines) {
    const prev = map.get(l.product.id);
    map.set(l.product.id, { product: l.product, qty: (prev?.qty ?? ZERO).plus(l.quantity) });
  }
  return map;
}

function shortagesOf(lines: PricedLine[]): SaleQuoteDto['shortages'] {
  return [...requestedByProduct(lines).values()]
    .filter(({ product, qty }) => qty.gt(product.stockQuantity))
    .map(({ product, qty }) => ({
      productId: product.id,
      requested: qtyStr(qty),
      available: qtyStr(product.stockQuantity),
    }));
}

function toQuote(lines: PricedLine[]): SaleQuoteDto {
  const totals = sumTotals(lines);
  return {
    lines: lines.map((l): QuoteLineDto => ({
      productId: l.product.id,
      productName: l.product.name,
      localNames: readLocalNames(l.product.localNames),
      unit: l.product.unit,
      quantity: qtyStr(l.quantity),
      unitPrice: moneyStr(l.product.sellingPrice),
      priceIncludesTax: l.product.priceIncludesTax,
      taxRate: moneyStr(l.product.taxRate),
      grossAmount: moneyStr(l.grossAmount),
      discountAmount: moneyStr(l.discountAmount),
      taxableValue: moneyStr(l.taxableValue),
      taxAmount: moneyStr(l.taxAmount),
      lineTotal: moneyStr(l.lineTotal),
      available: qtyStr(l.product.stockQuantity),
    })),
    totals: {
      taxableTotal: moneyStr(totals.taxableTotal),
      taxTotal: moneyStr(totals.taxTotal),
      discountTotal: moneyStr(totals.discountTotal),
      grandTotal: moneyStr(totals.grandTotal),
    },
    shortages: shortagesOf(lines),
  };
}

/** Row-locks products in a fixed (sorted) order so concurrent bills cannot deadlock. */
async function lockProducts(tx: Tx, storeId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT "id" FROM "Product"
    WHERE "storeId" = ${storeId}::uuid AND "id" = ANY(${ids}::uuid[])
    ORDER BY "id" FOR UPDATE`;
}

async function loadProducts(db: Db, storeId: string, ids: string[]): Promise<Map<string, Product>> {
  const rows = await db.product.findMany({ where: { storeId, id: { in: ids } } });
  return new Map(rows.map((p) => [p.id, p]));
}

const uniqueSorted = (ids: string[]) => [...new Set(ids)].sort();

interface StoreCounterRow {
  number: number;
  receiptLanguage: SaleDto['receiptLanguage'];
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  invoicePrefix: string | null;
  receiptFooter: string | null;
}

/**
 * Next serial in the store's invoice series for `fiscalYear` (the first bill of a year gets 1).
 * Callers hold the Store row lock, so serials are consecutive and gap-free like bill numbers.
 */
async function nextInvoiceSeq(tx: Tx, storeId: string, fiscalYear: number): Promise<number> {
  const [row] = await tx.$queryRaw<{ seq: number }[]>`
    INSERT INTO "InvoiceCounter" ("storeId", "fiscalYear", "nextSeq")
    VALUES (${storeId}::uuid, ${fiscalYear}, 2)
    ON CONFLICT ("storeId", "fiscalYear")
    DO UPDATE SET "nextSeq" = "InvoiceCounter"."nextSeq" + 1
    RETURNING "nextSeq" - 1 AS "seq"`;
  return row!.seq;
}

async function withIdempotentRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    // Concurrent identical retries: the loser re-runs and finds the stored response.
    if (isUniqueViolation(e)) return attempt();
    throw e;
  }
}

export class SaleService {
  constructor(private readonly db: PrismaClient) {}

  /** Read-only pricing preview for the counter. Same rules as finalize. */
  async quote(storeId: string, items: SaleLineInput[]): Promise<SaleQuoteDto> {
    const products = await loadProducts(this.db, storeId, uniqueSorted(items.map((i) => i.productId)));
    return toQuote(priceLines(products, items));
  }

  async finalize(
    storeId: string,
    actorUserId: string,
    input: FinalizeSaleInput,
    idem: IdempotencyContext,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const productIds = uniqueSorted(input.items.map((i) => i.productId));

    return withIdempotentRetry(() =>
      this.db.$transaction(async (tx) => {
        await lockProducts(tx, storeId, productIds);
        const replay = await findReplay(tx, idem);
        if (replay) return { ...replay, replayed: true };

        // Prices and stock are read after the lock: nothing can change them until commit.
        const lines = priceLines(await loadProducts(tx, storeId, productIds), input.items);
        const totals = sumTotals(lines);

        if (!roundMoney(dec(input.expectedGrandTotal)).equals(totals.grandTotal)) {
          throw new AppError(409, 'TOTAL_CHANGED', 'Prices changed since the bill was shown', {
            quote: toQuote(lines),
          });
        }
        const shortages = shortagesOf(lines);
        if (shortages.length > 0) {
          throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this bill', { shortages });
        }

        let paid = ZERO;
        for (const p of input.payments) {
          const amount = dec(p.amount);
          if (amount.lte(0)) throw new AppError(400, 'INVALID_PAYMENT', 'Payment amounts must be positive');
          if (p.tendered !== undefined && dec(p.tendered).lt(amount)) {
            throw new AppError(422, 'TENDERED_TOO_LOW', 'Cash handed over is less than the amount');
          }
          paid = paid.plus(amount);
        }
        if (!paid.equals(totals.grandTotal)) {
          throw new AppError(422, 'PAYMENT_MISMATCH', 'Payments must add up to the bill total', {
            grandTotal: moneyStr(totals.grandTotal),
            paid: moneyStr(paid),
          });
        }

        // Gap-free per-store numbering: the counter row is locked until this transaction ends.
        const [counter] = await tx.$queryRaw<StoreCounterRow[]>`
          UPDATE "Store" SET "nextSaleNumber" = "nextSaleNumber" + 1, "updatedAt" = now()
          WHERE "id" = ${storeId}::uuid
          RETURNING "nextSaleNumber" - 1 AS "number", "receiptLanguage", "name", "address", "phone",
                    "gstin", "invoicePrefix", "receiptFooter"`;
        if (!counter) throw notFound('Store');

        // Taken after the Store lock, so bill time, bill number and invoice serial all agree.
        const createdAt = new Date();
        const fiscalYear = fiscalYearOf(createdAt);
        const invoiceSeq = await nextInvoiceSeq(tx, storeId, fiscalYear);
        const invoiceNumber = formatInvoiceNumber(counter.invoicePrefix, fiscalYear, invoiceSeq);
        if (invoiceNumber.length > INVOICE_NUMBER_MAX) {
          throw new AppError(409, 'INVOICE_SERIES_FULL', 'Invoice numbers for this year are used up');
        }
        const seller: SellerDto = {
          name: counter.name,
          address: counter.address,
          phone: counter.phone,
          gstin: counter.gstin,
          footer: counter.receiptFooter,
        };

        const sale = await tx.sale.create({
          data: {
            storeId,
            number: counter.number,
            fiscalYear,
            invoiceSeq,
            invoiceNumber,
            seller: { ...seller },
            createdAt,
            source: input.source,
            taxableTotal: totals.taxableTotal,
            taxTotal: totals.taxTotal,
            discountTotal: totals.discountTotal,
            grandTotal: totals.grandTotal,
            receiptLanguage: counter.receiptLanguage,
            createdById: actorUserId,
          },
        });
        await tx.saleItem.createMany({
          data: lines.map((l, i) => ({
            id: randomUUID(),
            storeId,
            saleId: sale.id,
            productId: l.product.id,
            lineNo: i + 1,
            productName: l.product.name,
            localNames: l.product.localNames ?? {},
            unit: l.product.unit,
            quantity: l.quantity,
            unitPrice: l.product.sellingPrice,
            priceIncludesTax: l.product.priceIncludesTax,
            taxRate: l.product.taxRate,
            grossAmount: l.grossAmount,
            discountAmount: l.discountAmount,
            taxableValue: l.taxableValue,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
          })),
        });
        if (input.payments.length > 0) {
          await tx.salePayment.createMany({
            data: input.payments.map((p) => ({
              storeId,
              saleId: sale.id,
              method: p.method,
              amount: p.amount,
              tendered: p.tendered ?? null,
            })),
          });
        }

        for (const { product, qty } of [...requestedByProduct(lines).values()].sort((a, b) =>
          a.product.id.localeCompare(b.product.id),
        )) {
          const balanceAfter = product.stockQuantity.minus(qty);
          await tx.product.update({ where: { id: product.id }, data: { stockQuantity: balanceAfter } });
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: product.id,
              type: 'SALE',
              quantityDelta: qty.negated(),
              balanceAfter,
              actorUserId,
              saleId: sale.id,
            },
          });
        }

        await recordAudit(tx, {
          storeId,
          actorUserId,
          action: 'sale.finalized',
          entityType: 'Sale',
          entityId: sale.id,
          metadata: {
            number: sale.number,
            invoiceNumber,
            source: input.source,
            grandTotal: moneyStr(totals.grandTotal),
            discountTotal: moneyStr(totals.discountTotal),
            lines: lines.length,
          },
        });

        const full = await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
        const response: StoredResponse = { status: 201, body: { sale: toSaleDto(full) } };
        await saveResponse(tx, idem, response);
        return { ...response, replayed: false };
      }),
    );
  }

  async createReturn(
    storeId: string,
    actorUserId: string,
    saleId: string,
    input: CreateReturnInput,
    idem: IdempotencyContext,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const seen = new Set<string>();
    for (const i of input.items) {
      if (seen.has(i.saleItemId)) {
        throw new AppError(400, 'DUPLICATE_RETURN_LINE', 'Each bill line may appear once per return');
      }
      seen.add(i.saleItemId);
    }

    return withIdempotentRetry(() =>
      this.db.$transaction(async (tx) => {
        // Serialise returns per sale so two clerks cannot both return the last unit.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Sale" WHERE "id" = ${saleId}::uuid AND "storeId" = ${storeId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw notFound('Sale');
        const replay = await findReplay(tx, idem);
        if (replay) return { ...replay, replayed: true };

        const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude });
        const itemsById = new Map(sale.items.map((i) => [i.id, i]));
        const returned = returnedByItem(sale.returns);

        const rows = input.items.map((req) => {
          const item = itemsById.get(req.saleItemId);
          if (!item) {
            throw new AppError(404, 'SALE_ITEM_NOT_FOUND', 'Bill line not found', {
              saleItemId: req.saleItemId,
            });
          }
          if (!isQuantityValidForUnit(req.quantity, item.unit)) {
            throw new AppError(400, 'INVALID_QUANTITY_FOR_UNIT', `Whole numbers only for ${item.unit}`);
          }
          const qty = dec(req.quantity);
          if (qty.isZero())
            throw new AppError(400, 'QUANTITY_MUST_BE_POSITIVE', 'Quantity must be greater than zero');
          const already = returned.get(item.id) ?? ZERO;
          if (already.plus(qty).gt(item.quantity)) {
            throw new AppError(409, 'RETURN_EXCEEDS_SOLD', 'More than was sold on this line', {
              saleItemId: item.id,
              sold: qtyStr(item.quantity),
              alreadyReturned: qtyStr(already),
            });
          }
          return { item, qty, ...refundForReturn(item, already, qty) };
        });

        const refundTotal = rows.reduce((t, r) => t.plus(r.refundAmount), ZERO);
        const taxRefunded = rows.reduce((t, r) => t.plus(r.taxRefunded), ZERO);
        const saleReturn = await tx.saleReturn.create({
          data: {
            storeId,
            saleId,
            reason: input.reason,
            restocked: input.restock,
            refundMethod: input.refundMethod,
            refundTotal,
            taxRefunded,
            createdById: actorUserId,
          },
        });
        await tx.saleReturnItem.createMany({
          data: rows.map((r) => ({
            storeId,
            saleReturnId: saleReturn.id,
            saleId,
            saleItemId: r.item.id,
            quantity: r.qty,
            refundAmount: r.refundAmount,
            taxRefunded: r.taxRefunded,
          })),
        });

        if (input.restock) {
          const perProduct = new Map<string, Decimal>();
          for (const r of rows) {
            perProduct.set(r.item.productId, (perProduct.get(r.item.productId) ?? ZERO).plus(r.qty));
          }
          const ids = uniqueSorted([...perProduct.keys()]);
          await lockProducts(tx, storeId, ids);
          const products = await loadProducts(tx, storeId, ids);
          for (const id of ids) {
            const product = products.get(id)!;
            const qty = perProduct.get(id)!;
            const balanceAfter = product.stockQuantity.plus(qty);
            await tx.product.update({ where: { id }, data: { stockQuantity: balanceAfter } });
            await tx.inventoryMovement.create({
              data: {
                storeId,
                productId: id,
                type: 'RETURN',
                quantityDelta: qty,
                balanceAfter,
                actorUserId,
                saleReturnId: saleReturn.id,
              },
            });
          }
        }

        await recordAudit(tx, {
          storeId,
          actorUserId,
          action: 'sale.returned',
          entityType: 'Sale',
          entityId: saleId,
          metadata: {
            saleReturnId: saleReturn.id,
            number: sale.number,
            refundTotal: moneyStr(refundTotal),
            refundMethod: input.refundMethod,
            restocked: input.restock,
          },
        });

        const full = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude });
        const response: StoredResponse = { status: 201, body: { sale: toSaleDto(full) } };
        await saveResponse(tx, idem, response);
        return { ...response, replayed: false };
      }),
    );
  }

  async get(storeId: string, saleId: string): Promise<SaleDto> {
    const sale = await this.db.sale.findFirst({ where: { id: saleId, storeId }, include: saleInclude });
    if (!sale) throw notFound('Sale');
    return toSaleDto(sale);
  }

  /** In the bill's own receipt language unless a reprint asks for another. */
  async receipt(storeId: string, saleId: string, lang?: UiLanguage): Promise<ReceiptDto> {
    const sale = await this.db.sale.findFirst({ where: { id: saleId, storeId }, include: saleInclude });
    if (!sale) throw notFound('Sale');
    return toReceiptDto(sale, lang ?? sale.receiptLanguage);
  }

  async list(
    storeId: string,
    opts: { limit: number; beforeNumber?: number },
  ): Promise<{ sales: SaleSummaryDto[]; nextBeforeNumber: number | null }> {
    const rows = await this.db.sale.findMany({
      where: { storeId, ...(opts.beforeNumber ? { number: { lt: opts.beforeNumber } } : {}) },
      orderBy: { number: 'desc' },
      take: opts.limit + 1,
      include: {
        items: { select: { id: true, quantity: true } },
        returns: { select: { refundTotal: true, items: { select: { saleItemId: true, quantity: true } } } },
      },
    });
    const page = rows.slice(0, opts.limit);
    return {
      sales: page.map(toSaleSummaryDto),
      nextBeforeNumber: rows.length > opts.limit ? (page.at(-1)?.number ?? null) : null,
    };
  }
}
