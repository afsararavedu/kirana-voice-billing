import type { Prisma } from '@prisma/client';
import type {
  ReceiptDto,
  SaleDto,
  SalePaymentDto,
  SaleStatus,
  SaleSummaryDto,
  SellerDto,
  TaxRateSummaryDto,
  UiLanguage,
} from '@kirana/shared';
import type { Decimal } from '../../lib/decimal.js';
import { dec, moneyStr, qtyStr } from '../../lib/decimal.js';
import { readLocalNames } from '../products/product.mapper.js';
import { taxByRate } from './pricing.js';

export const saleInclude = {
  items: { orderBy: { lineNo: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  returns: { orderBy: { createdAt: 'asc' }, include: { items: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SaleInclude;

export type SaleWithDetails = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

/** Quantity returned so far per sale item. */
export function returnedByItem(returns: { items: { saleItemId: string; quantity: Decimal }[] }[]) {
  const map = new Map<string, Decimal>();
  for (const r of returns) {
    for (const i of r.items) map.set(i.saleItemId, (map.get(i.saleItemId) ?? dec('0')).plus(i.quantity));
  }
  return map;
}

/** Status is derived from return records; the sale row itself is never updated. */
export function deriveStatus(
  items: { id: string; quantity: Decimal }[],
  returned: Map<string, Decimal>,
): SaleStatus {
  if (returned.size === 0) return 'COMPLETED';
  const all = items.every((i) => (returned.get(i.id) ?? dec('0')).gte(i.quantity));
  return all ? 'RETURNED' : 'PARTIALLY_RETURNED';
}

const sumRefunds = (returns: { refundTotal: Decimal }[]) =>
  returns.reduce((t, r) => t.plus(r.refundTotal), dec('0'));

export function toSaleDto(s: SaleWithDetails): SaleDto {
  const returned = returnedByItem(s.returns);
  return {
    id: s.id,
    number: s.number,
    invoiceNumber: s.invoiceNumber,
    status: deriveStatus(s.items, returned),
    source: s.source,
    receiptLanguage: s.receiptLanguage,
    createdAt: s.createdAt.toISOString(),
    createdBy: s.createdBy,
    taxableTotal: moneyStr(s.taxableTotal),
    taxTotal: moneyStr(s.taxTotal),
    discountTotal: moneyStr(s.discountTotal),
    grandTotal: moneyStr(s.grandTotal),
    refundedTotal: moneyStr(sumRefunds(s.returns)),
    items: s.items.map((i) => ({
      id: i.id,
      lineNo: i.lineNo,
      productId: i.productId,
      productName: i.productName,
      localNames: readLocalNames(i.localNames),
      unit: i.unit,
      quantity: qtyStr(i.quantity),
      unitPrice: moneyStr(i.unitPrice),
      priceIncludesTax: i.priceIncludesTax,
      taxRate: moneyStr(i.taxRate),
      grossAmount: moneyStr(i.grossAmount),
      discountAmount: moneyStr(i.discountAmount),
      taxableValue: moneyStr(i.taxableValue),
      taxAmount: moneyStr(i.taxAmount),
      lineTotal: moneyStr(i.lineTotal),
      returnedQuantity: qtyStr(returned.get(i.id) ?? dec('0')),
    })),
    payments: s.payments.map(toPaymentDto),
    returns: s.returns.map((r) => ({
      id: r.id,
      reason: r.reason,
      restocked: r.restocked,
      refundMethod: r.refundMethod,
      refundTotal: moneyStr(r.refundTotal),
      taxRefunded: moneyStr(r.taxRefunded),
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((i) => ({
        saleItemId: i.saleItemId,
        quantity: qtyStr(i.quantity),
        refundAmount: moneyStr(i.refundAmount),
      })),
    })),
  };
}

function toPaymentDto(p: SaleWithDetails['payments'][number]): SalePaymentDto {
  return {
    method: p.method,
    amount: moneyStr(p.amount),
    tendered: p.tendered ? moneyStr(p.tendered) : null,
    change: p.tendered ? moneyStr(p.tendered.minus(p.amount)) : null,
  };
}

const nullableText = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** The seller snapshot is written by finalize; read defensively since it is JSON. */
export function readSeller(json: Prisma.JsonValue): SellerDto {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  return {
    name: typeof o.name === 'string' ? o.name : '',
    address: nullableText(o.address),
    phone: nullableText(o.phone),
    gstin: nullableText(o.gstin),
    footer: nullableText(o.footer),
  };
}

/** Receipt for `language`: item names fall back to the name entered in the catalog. */
export function toReceiptDto(s: SaleWithDetails, language: UiLanguage): ReceiptDto {
  const seller = readSeller(s.seller);
  const refunded = sumRefunds(s.returns);
  return {
    language,
    kind: seller.gstin ? 'TAX_INVOICE' : 'BILL',
    seller,
    invoiceNumber: s.invoiceNumber,
    number: s.number,
    createdAt: s.createdAt.toISOString(),
    cashier: s.createdBy.displayName,
    status: deriveStatus(s.items, returnedByItem(s.returns)),
    lines: s.items.map((i) => ({
      lineNo: i.lineNo,
      name: readLocalNames(i.localNames)[language] || i.productName,
      unit: i.unit,
      quantity: qtyStr(i.quantity),
      unitPrice: moneyStr(i.unitPrice),
      taxRate: moneyStr(i.taxRate),
      discountAmount: moneyStr(i.discountAmount),
      lineTotal: moneyStr(i.lineTotal),
    })),
    taxSummary: taxByRate(s.items).map(toTaxRateDto),
    totals: {
      taxableTotal: moneyStr(s.taxableTotal),
      taxTotal: moneyStr(s.taxTotal),
      discountTotal: moneyStr(s.discountTotal),
      grandTotal: moneyStr(s.grandTotal),
    },
    payments: s.payments.map(toPaymentDto),
    refundedTotal: moneyStr(refunded),
    netTotal: moneyStr(s.grandTotal.minus(refunded)),
  };
}

export function toTaxRateDto(r: ReturnType<typeof taxByRate>[number]): TaxRateSummaryDto {
  return {
    rate: moneyStr(r.rate),
    taxableValue: moneyStr(r.taxableValue),
    cgst: moneyStr(r.cgst),
    sgst: moneyStr(r.sgst),
    tax: moneyStr(r.tax),
  };
}

export function toSaleSummaryDto(
  s: Prisma.SaleGetPayload<{
    include: {
      items: { select: { id: true; quantity: true } };
      returns: { select: { refundTotal: true; items: { select: { saleItemId: true; quantity: true } } } };
    };
  }>,
): SaleSummaryDto {
  return {
    id: s.id,
    number: s.number,
    invoiceNumber: s.invoiceNumber,
    status: deriveStatus(s.items, returnedByItem(s.returns)),
    grandTotal: moneyStr(s.grandTotal),
    refundedTotal: moneyStr(sumRefunds(s.returns)),
    itemCount: s.items.length,
    createdAt: s.createdAt.toISOString(),
  };
}
