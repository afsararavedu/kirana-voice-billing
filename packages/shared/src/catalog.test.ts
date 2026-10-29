import { describe, expect, it } from 'vitest';
import {
  createProductSchema,
  isQuantityValidForUnit,
  moneyString,
  normalizeTerm,
  signedQuantityString,
  stockMovementSchema,
  taxRateString,
  updateProductSchema,
} from './catalog.js';

describe('decimal string validators', () => {
  it('accepts money with at most 2 decimals and rejects numbers, negatives and floats', () => {
    expect(moneyString.safeParse('12').success).toBe(true);
    expect(moneyString.safeParse('12.50').success).toBe(true);
    expect(moneyString.safeParse('12.505').success).toBe(false);
    expect(moneyString.safeParse('-1').success).toBe(false);
    expect(moneyString.safeParse('1e3').success).toBe(false);
    expect(moneyString.safeParse(12.5).success).toBe(false);
    expect(moneyString.safeParse('99999999999').success).toBe(false); // > Decimal(12,2)
  });

  it('bounds tax rates to 0–100', () => {
    expect(taxRateString.safeParse('18').success).toBe(true);
    expect(taxRateString.safeParse('100.00').success).toBe(true);
    expect(taxRateString.safeParse('100.01').success).toBe(false);
  });

  it('rejects a zero signed quantity', () => {
    expect(signedQuantityString.safeParse('-0.000').success).toBe(false);
    expect(signedQuantityString.safeParse('-0.250').success).toBe(true);
  });
});

describe('unit-aware quantities', () => {
  it('allows fractions only for weight/volume units', () => {
    expect(isQuantityValidForUnit('1.250', 'KG')).toBe(true);
    expect(isQuantityValidForUnit('1.5', 'PIECE')).toBe(false);
    expect(isQuantityValidForUnit('3.000', 'PACK')).toBe(true);
    expect(isQuantityValidForUnit('-2', 'DOZEN')).toBe(true);
  });

  it('rejects a fractional opening stock for PIECE products', () => {
    const r = createProductSchema.safeParse({
      name: 'Soap',
      unit: 'PIECE',
      sellingPrice: '30',
      openingStock: '2.5',
    });
    expect(r.success).toBe(false);
  });
});

describe('product schemas', () => {
  it('fills defaults', () => {
    const p = createProductSchema.parse({ name: ' Toor Dal ', unit: 'KG', sellingPrice: '140' });
    expect(p).toMatchObject({
      name: 'Toor Dal',
      taxRate: '0',
      priceIncludesTax: true,
      openingStock: '0',
      sku: null,
      aliases: [],
    });
  });

  it('does not allow changing the unit or unknown fields on update', () => {
    expect(updateProductSchema.safeParse({ unit: 'G' }).success).toBe(false);
    expect(updateProductSchema.safeParse({ stockQuantity: '100' }).success).toBe(false);
  });

  it('requires a reason for manual adjustments', () => {
    expect(stockMovementSchema.safeParse({ type: 'ADJUST', quantityDelta: '-1' }).success).toBe(false);
    expect(
      stockMovementSchema.safeParse({ type: 'ADJUST', quantityDelta: '-1', note: 'spilled' }).success,
    ).toBe(true);
  });
});

describe('normalizeTerm', () => {
  it('folds case, punctuation and whitespace', () => {
    expect(normalizeTerm('  Toor-Dal  (1kg) ')).toBe('toor dal 1kg');
  });

  it('strips zero-width joiners used in Indic/Urdu text', () => {
    expect(normalizeTerm('కంది\u200Cపప్పు')).toBe(normalizeTerm('కందిపప్పు'));
    expect(normalizeTerm('دال\u200D')).toBe('دال');
  });

  it('keeps combining marks (matras/nuktas)', () => {
    expect(normalizeTerm('चीनी')).toBe('चीनी');
  });
});
