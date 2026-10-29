import { z } from 'zod';
import type { ProductDto } from './catalog.js';
import { businessDate } from './invoice.js';
import type { PaymentMethod, SaleTotalsDto, TaxRateSummaryDto } from './sales.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-10-29')
  .refine((d) => {
    const noon = new Date(`${d}T12:00:00+05:30`);
    return !Number.isNaN(noon.getTime()) && businessDate(noon) === d;
  }, 'Not a real date');

export const dailyReportQuerySchema = z.object({
  /** IST calendar day; defaults to today. */
  date: isoDate.optional(),
});

/**
 * One IST day of trading. Sales are counted on the day they were billed and refunds on the day
 * they were given (even for an older bill), so the figures match the cash drawer.
 */
export interface DailySummaryDto {
  date: string;
  billCount: number;
  returnCount: number;
  sales: SaleTotalsDto;
  refunds: { total: string; tax: string };
  /** sales.grandTotal − refunds.total */
  netSales: string;
  /** Every method is listed, zero or not. */
  payments: { method: PaymentMethod; collected: string; refunded: string; net: string }[];
  /** GST on that day's bills by rate (before refunds). */
  taxByRate: TaxRateSummaryDto[];
}

export interface LowStockItemDto {
  product: ProductDto;
  /** Threshold − stock (how far below the alert level), or null when no threshold is set. */
  shortfall: string | null;
  outOfStock: boolean;
}

export const AUDIT_ENTITY_TYPES = ['Store', 'Product', 'Sale'] as const;

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Id of the last entry already shown (newest first). */
  before: z.uuid().optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
});

export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; displayName: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
