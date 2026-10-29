import { describe, expect, it } from 'vitest';
import { dec } from '../../lib/decimal.js';
import { priceLine, PricingError, refundForReturn, sumTotals, taxByRate } from './pricing.js';

const s = (l: Record<string, { toFixed: (n: number) => string }>) =>
  Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.toFixed(2)]));

describe('priceLine', () => {
  it('tax-inclusive MRP: extracts GST from the line total', () => {
    // 2 x â‚¹52.50 at 5% inclusive: total 105.00, taxable 100.00, GST 5.00
    const l = priceLine({ sellingPrice: dec('52.50'), taxRate: dec('5'), priceIncludesTax: true }, dec('2'));
    expect(s({ ...l })).toEqual({
      grossAmount: '105.00',
      discountAmount: '0.00',
      taxableValue: '100.00',
      taxAmount: '5.00',
      lineTotal: '105.00',
    });
  });

  it('tax-exclusive price: adds GST on top', () => {
    const l = priceLine({ sellingPrice: dec('100'), taxRate: dec('18'), priceIncludesTax: false }, dec('1'));
    expect(s({ ...l })).toMatchObject({ taxableValue: '100.00', taxAmount: '18.00', lineTotal: '118.00' });
  });

  it('rounds weighed quantities half-up to the paisa', () => {
    // 1.235 kg x â‚¹45.50 = 56.1925 -> 56.19
    const l = priceLine(
      { sellingPrice: dec('45.50'), taxRate: dec('0'), priceIncludesTax: true },
      dec('1.235'),
    );
    expect(l.lineTotal.toFixed(2)).toBe('56.19');
    // 0.333 kg x â‚¹15 = 4.995 -> 5.00 (half-up, not banker's rounding)
    const m = priceLine({ sellingPrice: dec('15'), taxRate: dec('0'), priceIncludesTax: true }, dec('0.333'));
    expect(m.lineTotal.toFixed(2)).toBe('5.00');
  });

  it('inclusive tax: taxable + tax always equals the total, even with awkward rates', () => {
    for (const [price, rate] of [
      ['9.99', '12'],
      ['1.01', '28'],
      ['333.33', '18'],
      ['0.05', '5'],
    ] as const) {
      const l = priceLine({ sellingPrice: dec(price), taxRate: dec(rate), priceIncludesTax: true }, dec('3'));
      expect(l.taxableValue.plus(l.taxAmount).equals(l.lineTotal)).toBe(true);
      expect(l.taxAmount.gte(0)).toBe(true);
    }
  });

  it('applies discounts before tax and rejects discounts above the line amount', () => {
    const l = priceLine(
      { sellingPrice: dec('118'), taxRate: dec('18'), priceIncludesTax: true },
      dec('1'),
      dec('18'),
    );
    expect(s({ ...l })).toMatchObject({
      discountAmount: '18.00',
      lineTotal: '100.00',
      taxableValue: '84.75',
    });
    expect(() =>
      priceLine(
        { sellingPrice: dec('10'), taxRate: dec('0'), priceIncludesTax: true },
        dec('1'),
        dec('10.01'),
      ),
    ).toThrow(PricingError);
  });

  it('sums a bill from its lines', () => {
    const p = { sellingPrice: dec('10.10'), taxRate: dec('5'), priceIncludesTax: true };
    const t = sumTotals([priceLine(p, dec('1')), priceLine(p, dec('2')), priceLine(p, dec('3'))]);
    expect(t.grandTotal.toFixed(2)).toBe('60.60');
    expect(t.taxableTotal.plus(t.taxTotal).equals(t.grandTotal)).toBe(true);
  });
});

describe('refundForReturn', () => {
  it('partial returns of a â‚¹10.00 line for 3 units refund exactly â‚¹10.00 in total', () => {
    const line = { quantity: dec('3'), lineTotal: dec('10.00'), taxAmount: dec('0.48') };
    const r1 = refundForReturn(line, dec('0'), dec('1'));
    const r2 = refundForReturn(line, dec('1'), dec('1'));
    const r3 = refundForReturn(line, dec('2'), dec('1'));
    expect([r1, r2, r3].map((r) => r.refundAmount.toFixed(2))).toEqual(['3.33', '3.34', '3.33']);
    expect(r1.refundAmount.plus(r2.refundAmount).plus(r3.refundAmount).toFixed(2)).toBe('10.00');
    expect(r1.taxRefunded.plus(r2.taxRefunded).plus(r3.taxRefunded).toFixed(2)).toBe('0.48');
  });

  it('weighed partial return', () => {
    const line = { quantity: dec('1.500'), lineTotal: dec('210.75'), taxAmount: dec('10.04') };
    expect(refundForReturn(line, dec('0'), dec('0.5')).refundAmount.toFixed(2)).toBe('70.25');
  });
});

describe('taxByRate', () => {
  it('groups by rate and splits CGST/SGST so the halves add back up', () => {
    const rows = taxByRate([
      { taxRate: dec('18'), taxableValue: dec('25.42'), taxAmount: dec('4.58') },
      { taxRate: dec('5'), taxableValue: dec('100.00'), taxAmount: dec('5.00') },
      { taxRate: dec('18.00'), taxableValue: dec('25.42'), taxAmount: dec('4.57') },
      { taxRate: dec('0'), taxableValue: dec('62.00'), taxAmount: dec('0') },
    ]);
    expect(
      rows.map((r) => [
        r.rate.toFixed(2),
        ...[r.taxableValue, r.cgst, r.sgst, r.tax].map((d) => d.toFixed(2)),
      ]),
    ).toEqual([
      ['0.00', '62.00', '0.00', '0.00', '0.00'],
      ['5.00', '100.00', '2.50', '2.50', '5.00'],
      // 9.15 is odd: CGST takes the extra paisa
      ['18.00', '50.84', '4.58', '4.57', '9.15'],
    ]);
  });
});
