import type { UiLanguage, Unit } from '@kirana/shared';

const LOCALES: Record<UiLanguage, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ur: 'ur-IN' };

/**
 * Amounts and quantities use one convention for every UI language — Latin digits with Indian
 * lakh grouping (1,23,456.50) — so staff never see the same figure written two ways.
 * (ICU's ur-IN data uses Western grouping, which would differ from the other three.)
 */
const NUMBER_LOCALE = 'en-IN';

/**
 * Display-only formatting of server-provided decimal strings. Intl formats the string exactly
 * (no float conversion). `lang` is accepted for future per-language needs.
 */
export function formatMoney(amount: string, _lang: UiLanguage): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: 'currency',
    currency: 'INR',
    numberingSystem: 'latn',
  }).format(amount as Intl.StringNumericLiteral);
}

export function formatQty(qty: string, _lang: UiLanguage): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 3,
    numberingSystem: 'latn',
    signDisplay: 'auto',
  }).format(qty as Intl.StringNumericLiteral);
}

export function formatSignedQty(qty: string, _lang: UiLanguage): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 3,
    numberingSystem: 'latn',
    signDisplay: 'exceptZero',
  }).format(qty as Intl.StringNumericLiteral);
}

/** `timeZone` pins the zone (receipts always show IST); otherwise the device's zone is used. */
export function formatDateTime(iso: string, lang: UiLanguage, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALES[lang], {
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: 'latn',
    timeZone,
  }).format(new Date(iso));
}

/** Low when a threshold is set and stock is at or below it. Compared as exact decimals. */
export function isLowStock(stock: string, threshold: string | null): boolean {
  if (threshold === null) return false;
  return compareDecimalStrings(stock, threshold) <= 0;
}

/** Fixed-point decimal string → scaled BigInt (e.g. "12.5", 2 → 1250n). */
function scaled(s: string, dp: number): bigint {
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = s.replace(/^-/, '').split('.');
  const v = BigInt(i + f.padEnd(dp, '0').slice(0, dp));
  return neg ? -v : v;
}

/**
 * Display-only exact subtraction (a − b) of decimal strings, e.g. "change to give" before the
 * server confirms, or "quantity left to return". Never used for anything the server stores.
 */
export function subtractDecimal(a: string, b: string, dp: number): string {
  const d = scaled(a, dp) - scaled(b, dp);
  const neg = d < 0n;
  const digits = (neg ? -d : d).toString().padStart(dp + 1, '0');
  const out = dp ? `${digits.slice(0, -dp)}.${digits.slice(-dp)}` : digits;
  return neg ? `-${out}` : out;
}

/** Compares two non-negative fixed-point decimal strings without converting to float. */
export function compareDecimalStrings(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const width = Math.max(af.length, bf.length);
  const ax = BigInt(ai + af.padEnd(width, '0'));
  const bx = BigInt(bi + bf.padEnd(width, '0'));
  return ax === bx ? 0 : ax < bx ? -1 : 1;
}

export type { Unit };
