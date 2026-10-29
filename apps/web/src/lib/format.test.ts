import { describe, expect, it } from 'vitest';
import {
  compareDecimalStrings,
  formatMoney,
  formatQty,
  formatSignedQty,
  isLowStock,
  subtractDecimal,
} from './format';

describe('format', () => {
  it('formats rupees with Indian grouping and Latin digits in every language', () => {
    expect(formatMoney('123456.50', 'en')).toBe('₹1,23,456.50');
    for (const lang of ['hi', 'te', 'ur'] as const) {
      expect(formatMoney('123456.50', lang)).toBe('₹1,23,456.50');
    }
  });

  it('formats quantities exactly, trimming trailing zeros', () => {
    expect(formatQty('12.250', 'en')).toBe('12.25');
    expect(formatQty('5.000', 'en')).toBe('5');
    expect(formatSignedQty('0.500', 'en')).toBe('+0.5');
    expect(formatSignedQty('-0.125', 'en')).toBe('-0.125');
  });

  it('subtracts decimal strings exactly', () => {
    expect(subtractDecimal('500', '223.00', 2)).toBe('277.00');
    expect(subtractDecimal('0.30', '0.10', 2)).toBe('0.20');
    expect(subtractDecimal('100', '100.01', 2)).toBe('-0.01');
    expect(subtractDecimal('1.500', '0.5', 3)).toBe('1.000');
  });

  it('compares decimal strings without floats', () => {
    expect(compareDecimalStrings('2.000', '2')).toBe(0);
    expect(compareDecimalStrings('10.1', '9.999')).toBe(1);
    expect(compareDecimalStrings('0.3', '0.30000000000000004')).toBe(-1);
    expect(isLowStock('2.000', '2.000')).toBe(true);
    expect(isLowStock('2.001', '2.000')).toBe(false);
    expect(isLowStock('0.000', null)).toBe(false);
  });
});
