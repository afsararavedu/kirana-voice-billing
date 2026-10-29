import { z } from 'zod';

/**
 * Business dates (the Indian financial year, "today" in reports, the time on a receipt) are
 * Indian Standard Time whatever time zone the server or the phone is set to. IST has no DST.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;

/** Calendar date in IST as YYYY-MM-DD. */
export function businessDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) instants of an IST calendar day given as YYYY-MM-DD. */
export function businessDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 24 * 3_600_000) };
}

/** Indian financial year (1 April – 31 March, IST), identified by its starting calendar year. */
export function fiscalYearOf(at: Date): number {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return ist.getUTCMonth() < 3 ? ist.getUTCFullYear() - 1 : ist.getUTCFullYear();
}

/** 2026 → "26-27". */
export function fiscalYearLabel(fy: number): string {
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return `${yy(fy)}-${yy(fy + 1)}`;
}

/** GST rule 46: an invoice number is at most 16 characters of letters, digits, "-" and "/". */
export const INVOICE_NUMBER_MAX = 16;

/**
 * Invoice numbers run in one consecutive series per store per financial year:
 * "LK/26-27/123" with prefix "LK", or "26-27/123" without one.
 */
export function formatInvoiceNumber(prefix: string | null, fy: number, seq: number): string {
  return `${prefix ? `${prefix}/` : ''}${fiscalYearLabel(fy)}/${seq}`;
}

export const invoicePrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,4}$/, 'Use 1–4 letters or digits');

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN: 2-digit state code, PAN, entity number, "Z", and a mod-36 check character. */
export function isValidGstin(gstin: string): boolean {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

export const gstinSchema = z.string().trim().toUpperCase().refine(isValidGstin, 'Not a valid GSTIN');
