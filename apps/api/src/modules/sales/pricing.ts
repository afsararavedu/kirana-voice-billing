import { dec, Decimal, roundMoney } from '../../lib/decimal.js';

/**
 * The single place where bill amounts are computed. Pure: no I/O, Decimal in, Decimal out.
 *
 * Rules (all rounding half-up to the paisa, per line, then lines are summed):
 *   gross    = round(quantity x unitPrice)
 *   net      = gross - discount                      (discount is an absolute rupee amount <= gross)
 *   tax-inclusive price (MRP):  total = net;  taxable = round(net x 100 / (100 + rate));  tax = total - taxable
 *   tax-exclusive price:        taxable = net;  tax = round(net x rate / 100);  total = taxable + tax
 * Bill totals are sums of the stored line values, so a bill always equals the sum of its lines.
 */
export interface PricedProduct {
  sellingPrice: Decimal;
  taxRate: Decimal;
  priceIncludesTax: boolean;
}

export interface LineAmounts {
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxableValue: Decimal;
  taxAmount: Decimal;
  lineTotal: Decimal;
}

export class PricingError extends Error {
  constructor(readonly code: 'DISCOUNT_TOO_LARGE') {
    super(code);
  }
}

const HUNDRED = dec('100');

export function priceLine(
  product: PricedProduct,
  quantity: Decimal,
  discount: Decimal = dec('0'),
): LineAmounts {
  const grossAmount = roundMoney(quantity.times(product.sellingPrice));
  const discountAmount = roundMoney(discount);
  if (discountAmount.gt(grossAmount)) throw new PricingError('DISCOUNT_TOO_LARGE');
  const net = grossAmount.minus(discountAmount);

  if (product.priceIncludesTax) {
    const taxableValue = roundMoney(net.times(HUNDRED).dividedBy(HUNDRED.plus(product.taxRate)));
    return { grossAmount, discountAmount, taxableValue, taxAmount: net.minus(taxableValue), lineTotal: net };
  }
  const taxAmount = roundMoney(net.times(product.taxRate).dividedBy(HUNDRED));
  return { grossAmount, discountAmount, taxableValue: net, taxAmount, lineTotal: net.plus(taxAmount) };
}

export function sumTotals(lines: LineAmounts[]) {
  const zero = dec('0');
  return lines.reduce(
    (t, l) => ({
      taxableTotal: t.taxableTotal.plus(l.taxableValue),
      taxTotal: t.taxTotal.plus(l.taxAmount),
      discountTotal: t.discountTotal.plus(l.discountAmount),
      grandTotal: t.grandTotal.plus(l.lineTotal),
    }),
    { taxableTotal: zero, taxTotal: zero, discountTotal: zero, grandTotal: zero },
  );
}

/**
 * Refund for returning `qty` more of a line, given how much was already returned.
 * Computed cumulatively — round(total x (prev+qty)/sold) - round(total x prev/sold) — so any series
 * of partial returns refunds exactly the line total when everything has come back (no paisa drift).
 */
export function refundForReturn(
  line: { quantity: Decimal; lineTotal: Decimal; taxAmount: Decimal },
  alreadyReturned: Decimal,
  qty: Decimal,
): { refundAmount: Decimal; taxRefunded: Decimal } {
  const share = (q: Decimal, amount: Decimal) => roundMoney(amount.times(q).dividedBy(line.quantity));
  const after = alreadyReturned.plus(qty);
  return {
    refundAmount: share(after, line.lineTotal).minus(share(alreadyReturned, line.lineTotal)),
    taxRefunded: share(after, line.taxAmount).minus(share(alreadyReturned, line.taxAmount)),
  };
}

/**
 * GST by rate with the CGST/SGST split of an intra-state sale. Each rate's tax is the sum of its
 * stored line taxes; CGST = round(tax / 2) and SGST = tax − CGST, so the halves always add back up
 * (an odd paisa goes to CGST). Sorted by rate, ascending.
 */
export function taxByRate(lines: { taxRate: Decimal; taxableValue: Decimal; taxAmount: Decimal }[]) {
  const byRate = new Map<string, { rate: Decimal; taxableValue: Decimal; tax: Decimal }>();
  for (const l of lines) {
    const key = l.taxRate.toFixed(2);
    const prev = byRate.get(key) ?? { rate: l.taxRate, taxableValue: dec('0'), tax: dec('0') };
    byRate.set(key, {
      rate: prev.rate,
      taxableValue: prev.taxableValue.plus(l.taxableValue),
      tax: prev.tax.plus(l.taxAmount),
    });
  }
  return [...byRate.values()]
    .sort((a, b) => a.rate.comparedTo(b.rate))
    .map((r) => {
      const cgst = roundMoney(r.tax.dividedBy(2));
      return { ...r, cgst, sgst: r.tax.minus(cgst) };
    });
}

export { Decimal };
