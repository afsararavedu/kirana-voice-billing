import { z } from 'zod';
import { moneyString, quantityString, type LocalNames, type Unit } from './catalog.js';
import { UI_LANGUAGES, type UiLanguage } from './languages.js';

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const MAX_SALE_LINES = 200;

/** A cart line as sent by the client: product + quantity (+ optional rupee discount). Never a price. */
export const saleLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: quantityString,
    discount: moneyString.optional(),
  })
  .strict();
export type SaleLineInput = z.infer<typeof saleLineSchema>;

const lines = z.array(saleLineSchema).min(1).max(MAX_SALE_LINES);

export const quoteSaleSchema = z.object({ items: lines }).strict();
export type QuoteSaleInput = z.infer<typeof quoteSaleSchema>;

export const salePaymentSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: moneyString,
    /** Cash handed over; only for CASH. The server computes change. */
    tendered: moneyString.optional(),
  })
  .strict()
  .refine((p) => p.tendered === undefined || p.method === 'CASH', {
    message: 'tendered is only allowed for CASH',
    path: ['tendered'],
  });

export const finalizeSaleSchema = z
  .object({
    items: lines,
    payments: z.array(salePaymentSchema).max(5),
    /**
     * The grand total the cashier showed the customer (from a quote). If prices changed since,
     * the server refuses with TOTAL_CHANGED instead of charging a different amount.
     */
    expectedGrandTotal: moneyString,
    /** VOICE when lines came from voice suggestions. A label for reports; prices are unaffected. */
    source: z.enum(['MANUAL', 'VOICE']).default('MANUAL'),
  })
  .strict();
export type FinalizeSaleInput = z.infer<typeof finalizeSaleSchema>;
export type FinalizeSaleRequest = z.input<typeof finalizeSaleSchema>;

export const createReturnSchema = z
  .object({
    items: z
      .array(z.object({ saleItemId: z.uuid(), quantity: quantityString }).strict())
      .min(1)
      .max(MAX_SALE_LINES),
    reason: z.string().trim().min(1).max(255),
    /** Put goods back on the shelf (false for damaged/expired returns). */
    restock: z.boolean().default(true),
    refundMethod: z.enum(PAYMENT_METHODS),
  })
  .strict();
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type CreateReturnRequest = z.input<typeof createReturnSchema>;

export const saleListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Bill number to page before (newest first). */
  beforeNumber: z.coerce.number().int().min(2).optional(),
});

/** Derived, never stored: a sale is immutable and returns are separate records. */
export const SALE_STATUSES = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export interface QuoteLineDto {
  productId: string;
  productName: string;
  localNames: LocalNames;
  unit: Unit;
  quantity: string;
  unitPrice: string;
  priceIncludesTax: boolean;
  taxRate: string;
  grossAmount: string;
  discountAmount: string;
  taxableValue: string;
  taxAmount: string;
  lineTotal: string;
  /** Current stock, so the counter can warn before finalising. */
  available: string;
}

export interface SaleTotalsDto {
  taxableTotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
}

export interface SaleQuoteDto {
  lines: QuoteLineDto[];
  totals: SaleTotalsDto;
  /** Products whose requested quantity (summed across lines) exceeds stock. */
  shortages: { productId: string; requested: string; available: string }[];
}

export interface SaleItemDto extends Omit<QuoteLineDto, 'available'> {
  id: string;
  lineNo: number;
  returnedQuantity: string;
}

export interface SalePaymentDto {
  method: PaymentMethod;
  amount: string;
  tendered: string | null;
  change: string | null;
}

export interface SaleReturnDto {
  id: string;
  reason: string;
  restocked: boolean;
  refundMethod: PaymentMethod;
  refundTotal: string;
  taxRefunded: string;
  createdAt: string;
  items: { saleItemId: string; quantity: string; refundAmount: string }[];
}

export interface SaleDto extends SaleTotalsDto {
  id: string;
  number: number;
  /** GST invoice number, e.g. "LK/26-27/123" (see formatInvoiceNumber). */
  invoiceNumber: string;
  status: SaleStatus;
  source: 'MANUAL' | 'VOICE';
  receiptLanguage: UiLanguage;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  items: SaleItemDto[];
  payments: SalePaymentDto[];
  returns: SaleReturnDto[];
  refundedTotal: string;
}

export interface SaleSummaryDto {
  id: string;
  number: number;
  invoiceNumber: string;
  status: SaleStatus;
  grandTotal: string;
  refundedTotal: string;
  itemCount: number;
  createdAt: string;
}

/** GST at one rate, split equally into central and state tax (intra-state counter sale). */
export interface TaxRateSummaryDto {
  rate: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  tax: string;
}

/** Seller details as they were when the bill was made. */
export interface SellerDto {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  footer: string | null;
}

/**
 * Everything a printed receipt shows, already resolved for one language: item names are in
 * `language` where the catalog had them. Labels are translated by the client.
 */
export interface ReceiptDto {
  language: UiLanguage;
  /** TAX_INVOICE when the store had a GSTIN at the time of sale, otherwise a plain BILL. */
  kind: 'TAX_INVOICE' | 'BILL';
  seller: SellerDto;
  invoiceNumber: string;
  number: number;
  createdAt: string;
  cashier: string;
  status: SaleStatus;
  lines: {
    lineNo: number;
    name: string;
    unit: Unit;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    discountAmount: string;
    lineTotal: string;
  }[];
  taxSummary: TaxRateSummaryDto[];
  totals: SaleTotalsDto;
  payments: SalePaymentDto[];
  refundedTotal: string;
  /** grandTotal − refundedTotal. */
  netTotal: string;
}

/** `lang` reprints in another language; by default the receipt uses the bill's receipt language. */
export const receiptQuerySchema = z.object({ lang: z.enum(UI_LANGUAGES).optional() });
