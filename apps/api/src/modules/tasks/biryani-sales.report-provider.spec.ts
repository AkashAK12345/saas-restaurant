import { describe, it, expect } from 'vitest';
import { figureTotal, kgLabel } from './biryani-sales.report-provider.js';

const kg = (section: string, label: string, value: string | null) => ({
  label,
  section,
  kind: 'NUMBER',
  value,
  is_done: value !== null,
});

describe('Biryani Sales report helpers', () => {
  it('totals one figure over every product, though the question repeats per product', () => {
    const items = [
      kg('Chicken Biryani (Non-Veg)', 'Purchase (KG)', '12.5'),
      kg('Chicken Biryani (Non-Veg)', 'Morning (KG)', '4'),
      kg('Mutton Biryani (Non-Veg)', 'Purchase (KG)', '8'),
      kg('Appam (Veg)', 'Purchase (KG)', null),
    ];
    expect(figureTotal(items, 'Purchase (KG)')).toBe(20.5);
    expect(figureTotal(items, 'Morning (KG)')).toBe(4);
    expect(figureTotal(items, 'Evening (KG)')).toBe(0);
  });

  it('labels a weight', () => {
    expect(kgLabel(0)).toBe('0 KG');
    expect(kgLabel(12.5)).toBe('12.5 KG');
  });
});
