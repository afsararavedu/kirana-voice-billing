import { describe, expect, it } from 'vitest';
import {
  businessDate,
  businessDayRange,
  fiscalYearLabel,
  fiscalYearOf,
  formatInvoiceNumber,
  INVOICE_NUMBER_MAX,
  isValidGstin,
} from './invoice.js';
import { dailyReportQuerySchema } from './reports.js';
import { updateStoreSchema } from './schemas.js';

describe('Indian financial year (IST)', () => {
  it('starts on 1 April IST, not UTC', () => {
    // 31 Mar 2027 18:29:59Z = 23:59:59 IST → still FY 2026-27
    expect(fiscalYearOf(new Date('2027-03-31T18:29:59Z'))).toBe(2026);
    // 31 Mar 2027 18:30:00Z = 00:00 IST on 1 April → FY 2027-28
    expect(fiscalYearOf(new Date('2027-03-31T18:30:00Z'))).toBe(2027);
    expect(fiscalYearOf(new Date('2027-01-15T06:00:00Z'))).toBe(2026);
  });

  it('labels and formats invoice numbers', () => {
    expect(fiscalYearLabel(2026)).toBe('26-27');
    expect(fiscalYearLabel(2099)).toBe('99-00');
    expect(formatInvoiceNumber('LK', 2026, 123)).toBe('LK/26-27/123');
    expect(formatInvoiceNumber(null, 2026, 1)).toBe('26-27/1');
    // Longest prefix still leaves room for 99,999 bills in a year.
    expect(formatInvoiceNumber('ABCD', 2026, 99_999).length).toBeLessThanOrEqual(INVOICE_NUMBER_MAX);
  });

  it('maps business days to IST midnights', () => {
    expect(businessDate(new Date('2026-10-28T18:30:00Z'))).toBe('2026-10-29');
    expect(businessDate(new Date('2026-10-28T18:29:59Z'))).toBe('2026-10-28');
    const { start, end } = businessDayRange('2026-10-29');
    expect(start.toISOString()).toBe('2026-10-28T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-29T18:30:00.000Z');
  });

  it('rejects impossible report dates', () => {
    expect(dailyReportQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
    expect(dailyReportQuerySchema.safeParse({ date: '29-10-2026' }).success).toBe(false);
    expect(dailyReportQuerySchema.parse({ date: '2028-02-29' }).date).toBe('2028-02-29');
  });
});

describe('GSTIN', () => {
  it('accepts valid check characters and rejects typos', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('36AABCU9603R1ZO')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false); // wrong check character
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(false); // schema uppercases first
  });
});

describe('store profile updates', () => {
  it('normalises and clears fields', () => {
    expect(
      updateStoreSchema.parse({ gstin: ' 27aapfu0939f1zv ', invoicePrefix: 'lk', address: '  ' }),
    ).toEqual({ gstin: '27AAPFU0939F1ZV', invoicePrefix: 'LK', address: null });
    expect(updateStoreSchema.parse({ gstin: '', phone: null })).toEqual({ gstin: null, phone: null });
  });

  it('rejects bad values and unknown fields', () => {
    expect(updateStoreSchema.safeParse({ gstin: '27AAPFU0939F1ZW' }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ invoicePrefix: 'LK/1' }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ invoicePrefix: 'ABCDE' }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ phone: 'call me' }).success).toBe(false);
    expect(updateStoreSchema.safeParse({ nextSaleNumber: 1 }).success).toBe(false);
  });
});
