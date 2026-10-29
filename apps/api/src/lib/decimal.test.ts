import { describe, expect, it } from 'vitest';
import { dec, moneyStr, qtyStr, roundMoney } from './decimal.js';

describe('decimal helpers', () => {
  it('avoids binary floating-point error', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem
    expect(dec('0.1').plus(dec('0.2')).equals(dec('0.3'))).toBe(true);
    expect(moneyStr(dec('19.99').times(3))).toBe('59.97');
  });

  it('rounds half-up at the paisa', () => {
    expect(roundMoney(dec('2.345')).toFixed(2)).toBe('2.35');
    expect(roundMoney(dec('2.344')).toFixed(2)).toBe('2.34');
    expect(roundMoney(dec('1.005')).toFixed(2)).toBe('1.01'); // 1.005 is 1.00499… as a float
  });

  it('formats canonical wire strings', () => {
    expect(moneyStr(dec('12.5'))).toBe('12.50');
    expect(qtyStr(dec('1.25'))).toBe('1.250');
    expect(qtyStr(dec('-0.0005'))).toBe('-0.001');
  });
});
