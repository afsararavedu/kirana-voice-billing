import { describe, expect, it } from 'vitest';
import { resolveQuantity } from './catalog-matcher.js';

describe('resolveQuantity', () => {
  it.each([
    [{ quantity: '2', unit: null }, 'KG', { quantity: '2', problem: null }],
    [{ quantity: '500', unit: 'G' }, 'KG', { quantity: '0.5', problem: null }],
    [{ quantity: '1.5', unit: 'KG' }, 'G', { quantity: '1500', problem: null }],
    [{ quantity: '250', unit: 'ML' }, 'L', { quantity: '0.25', problem: null }],
    [{ quantity: '1', unit: 'DOZEN' }, 'PIECE', { quantity: '12', problem: null }],
    [{ quantity: '0.5', unit: 'DOZEN' }, 'PIECE', { quantity: '6', problem: null }],
    [{ quantity: null, unit: 'KG' }, 'KG', { quantity: null, problem: 'NEEDS_QUANTITY' }],
    [{ quantity: '2', unit: 'PACK' }, 'PIECE', { quantity: null, problem: 'UNIT_MISMATCH' }],
    [{ quantity: '1', unit: 'L' }, 'KG', { quantity: null, problem: 'UNIT_MISMATCH' }],
    [{ quantity: '1.5', unit: null }, 'PIECE', { quantity: null, problem: 'INVALID_QUANTITY' }],
    [{ quantity: '0.5', unit: 'G' }, 'KG', { quantity: null, problem: 'INVALID_QUANTITY' }],
  ] as const)('%o of a %s product → %o', (item, unit, expected) => {
    expect(resolveQuantity(item, unit)).toEqual(expected);
  });
});
