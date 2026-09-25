import { describe, it, expect } from 'vitest';
import { priceLine, purchasePrefix, stockQuantity } from './purchase.service.js';

describe('manual purchase arithmetic', () => {
  it('prices a line: quantity times rate, then GST on that, in whole paise', () => {
    // 12.5 Kg at ₹240.00, 5% GST.
    expect(priceLine(12.5, 24_000, 500)).toEqual({ net: 300_000, tax: 15_000, total: 315_000 });
    // 3 at ₹33.33, 18%: ₹99.99 + ₹18.00 (17.998 rounds).
    expect(priceLine(3, 3_333, 1_800)).toEqual({ net: 9_999, tax: 1_800, total: 11_799 });
    expect(priceLine(2, 0, 1_800)).toEqual({ net: 0, tax: 0, total: 0 });
  });

  it('converts bought units to stock units', () => {
    expect(stockQuantity(2, 50)).toBe(100);
    expect(stockQuantity(1.5, null)).toBe(1.5);
    expect(stockQuantity(0.333, 3)).toBe(0.999);
  });

  it('numbers a purchase by its branch-local day', () => {
    expect(purchasePrefix('2026-09-25')).toBe('MP-260925-');
  });
});
