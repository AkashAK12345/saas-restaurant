import { describe, it, expect } from 'vitest';
import { fitsOnHand, transferPrefix } from './transfer.service.js';
import { parseMenuProductSheet } from './menu-product-import.js';

describe('stock transfer rules', () => {
  it('numbers a transfer by the source’s local day', () => {
    expect(transferPrefix('2026-09-25')).toBe('TR-260925-');
  });

  it('sends no more than is on hand, to the thousandth', () => {
    expect(fitsOnHand(56, 56)).toBe(true);
    expect(fitsOnHand(56.001, 56)).toBe(false);
    // 0.1 + 0.2 on hand is 0.3, however floating point spells it.
    expect(fitsOnHand(0.3, 0.1 + 0.2)).toBe(true);
    expect(fitsOnHand(1, 0)).toBe(false);
    expect(fitsOnHand(1, -2)).toBe(false);
  });
});

describe('menu product sheet', () => {
  it('finds the header under a title, reads the columns it knows, reports the rest', () => {
    const parsed = parseMenuProductSheet([
      ['Menu export'],
      [],
      ['Item Name', 'Category', 'Price', 'Short Code', 'Status', 'Colour'],
      ['Chicken Biriyani', 'Biryani', 280, 'CB', 'Active', 'red'],
      ['Appam  Batter', '', '₹1,200.50', '', 'Inactive', ''],
      ['Hall Charges', 'Banquet', 0, '', '', ''],
      [null, null, null],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignored).toEqual(['Colour']);
    expect(parsed.products).toEqual([
      { row: 4, name: 'Chicken Biriyani', category: 'Biryani', unit: null, short_code: 'CB', price_minor: 28_000, is_active: true },
      { row: 5, name: 'Appam Batter', category: null, unit: null, short_code: null, price_minor: 120_050, is_active: false },
      // Zero is "no price".
      { row: 6, name: 'Hall Charges', category: 'Banquet', unit: null, short_code: null, price_minor: null, is_active: true },
    ]);
  });

  it('refuses a sheet with no name column, repeated names, and bad prices', () => {
    expect(parseMenuProductSheet([['Code', 'Price']]).errors).toEqual(['No header row naming "Name" or "Product"']);
    const parsed = parseMenuProductSheet([
      ['Name', 'Price'],
      ['Ribs', 'ten'],
      ['Ran', 100],
      ['ran', 120],
      ['', 5],
    ]);
    expect(parsed.errors).toEqual(['Row 2: price "ten" is not an amount', 'Row 4: "ran" appears more than once', 'Row 5: needs a name']);
    expect(parsed.products.map((p) => p.name)).toEqual(['Ran']);
  });
});
