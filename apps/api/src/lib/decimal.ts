import { Prisma } from '@prisma/client';

/**
 * All authoritative money/quantity arithmetic goes through decimal.js (Prisma.Decimal), never JS numbers.
 * Rounding rule: half-up (commercial rounding) — money to 2 places (paise), quantity to 3.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
export const MONEY_DP = 2;
export const QTY_DP = 3;

export function dec(v: string | Decimal): Decimal {
  return new Decimal(v);
}

export function roundMoney(d: Decimal): Decimal {
  return d.toDecimalPlaces(MONEY_DP, HALF_UP);
}

export function roundQty(d: Decimal): Decimal {
  return d.toDecimalPlaces(QTY_DP, HALF_UP);
}

/** Canonical wire format: fixed decimals, e.g. "12.50", "1.250". */
export const moneyStr = (d: Decimal) => roundMoney(d).toFixed(MONEY_DP);
export const qtyStr = (d: Decimal) => roundQty(d).toFixed(QTY_DP);
