import { describe, it, expect } from 'vitest';
import { parseInventorySheet } from './inventory-import.js';

const BRANCHES = ['Pallavaram', 'Anna Nagar'];

describe('parseInventorySheet', () => {
  it('reads name, unit, category and department in any column order and case', () => {
    const parsed = parseInventorySheet(
      [
        ['CATEGORY', 'Item Name', 'uom', 'Dept'],
        ['Beverages', '7 Up Can 300 Ml', 'case', ''],
        ['Food & Beverages', '  Aachi   Kolambu Masala ', 'Kg', 'indian'],
      ],
      BRANCHES,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toMatchObject([
      { row: 2, name: '7 Up Can 300 Ml', unit: 'case', category: 'Beverages', department: null, opening: {}, is_active: true },
      { row: 3, name: 'Aachi Kolambu Masala', unit: 'Kg', category: 'Food & Beverages', department: 'Indian' },
    ]);
  });

  it('reads a POS "Raw Material Report" export: title rows skipped, prices, tax and conversions kept', () => {
    const parsed = parseInventorySheet(
      [
        ['Name:', 'Raw Material Report'],
        ['Restaurant Name:', 'SAMCO RESTAURANT Mogappair'],
        [],
        [
          'Name',
          'Purchase Unit',
          'Conversion Qty',
          'Consumption Unit',
          'Purchase Price',
          'Transfer Price',
          'Tax Type',
          'Tax(%)',
          'HSN',
          'Category',
          'Sub Category',
          'Barcode/Short Code',
          'Active',
          'Restock Level',
          'Restock Level',
        ],
        ['Dust Pan', 'Piece', 0, 'Piece', 35, 0, 'GST', 18, null, 'Hygiene & Cleaning', 'Cleaning Tools', 'dust pan', 'Yes'],
        ['Sugar 50 Kg Bag', 'Bag', 50, 'Kg', 2150.5, 2150.5, 'GST', 0, '1701', 'Food & Beverages', null, null, 'No'],
      ],
      BRANCHES,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignored).toEqual(['Tax Type', 'Restock Level']);
    expect(parsed.items).toEqual([
      {
        row: 5,
        name: 'Dust Pan',
        unit: 'Piece',
        category: 'Hygiene & Cleaning',
        sub_category: 'Cleaning Tools',
        department: null,
        // Bought as counted: no purchase unit to keep.
        purchase_unit: null,
        conversion_qty: null,
        purchase_price_minor: 3_500,
        // Zero is the export's "no price".
        transfer_price_minor: null,
        tax_rate_bps: 1_800,
        hsn: null,
        short_code: 'dust pan',
        is_active: true,
        opening: {},
      },
      {
        row: 6,
        name: 'Sugar 50 Kg Bag',
        unit: 'Kg',
        category: 'Food & Beverages',
        sub_category: null,
        department: null,
        purchase_unit: 'Bag',
        conversion_qty: 50,
        purchase_price_minor: 215_050,
        transfer_price_minor: 215_050,
        tax_rate_bps: 0,
        hsn: '1701',
        short_code: null,
        is_active: false,
        opening: {},
      },
    ]);
  });

  it('treats a column named after a branch as its opening stock, and ignores others', () => {
    const parsed = parseInventorySheet(
      [
        ['Name', 'Unit', 'pallavaram', 'Anna Nagar', 'Notes'],
        ['Laptop', 'BOX', '2', '1,200.5', 'office'],
        ['Onion', 'Kg', '', '0', ''],
      ],
      BRANCHES,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignored).toEqual(['Notes']);
    expect(parsed.items[0].opening).toEqual({ Pallavaram: 2, 'Anna Nagar': 1200.5 });
    expect(parsed.items[1].opening).toEqual({});
  });

  it('skips blank rows and reports every bad row by its sheet row number', () => {
    const parsed = parseInventorySheet(
      [
        ['Name', 'Unit', 'Department', 'Pallavaram', 'Purchase Unit', 'Purchase Price'],
        ['', '', '', ''],
        ['Onion', '', '', ''],
        ['Paneer', 'Kg', 'Continental', ''],
        ['Rice', 'Kg', '', 'lots'],
        ['Rice', 'kg', '', ''],
        ['rice', 'KG', '', ''],
        ['Maida', 'Kg', '', '', 'Bag'],
        ['Oil', 'ltr', '', '', '', 'free'],
      ],
      BRANCHES,
    );
    expect(parsed.errors).toEqual([
      'Row 3: needs both a name and a unit',
      'Row 4: department "Continental" is not one of Indian, Chinese, Tandoori, BBQ, Turkish, Staff Food, Pick Up',
      'Row 5: opening stock "lots" at Pallavaram is not a quantity (up to 3 decimals)',
      'Row 7: "rice" (KG) appears more than once',
      'Row 8: bought in "Bag" but counted in "Kg", with no conversion quantity',
      'Row 9: purchase price "free" is not an amount',
    ]);
    expect(parsed.items.map((i) => i.row)).toEqual([6]);
  });

  it('refuses a sheet without a header naming both the item and its unit', () => {
    expect(parseInventorySheet([['Product', 'Price']], BRANCHES).errors).toEqual([
      'No header row naming both "Name" and "Unit" in the first rows',
    ]);
    expect(parseInventorySheet([], BRANCHES).errors).toHaveLength(1);
  });
});
