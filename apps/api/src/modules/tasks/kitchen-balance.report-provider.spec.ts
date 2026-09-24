import { describe, it, expect } from 'vitest';
import { balanceTotals } from './kitchen-balance.report-provider.js';

const n = (section: string, value: string | null) => ({ kind: 'NUMBER', value, is_done: value !== null, section });

describe('Kitchen Balance report helpers', () => {
  it('totals every count, and each section on its own', () => {
    const { total, bySection } = balanceTotals([
      n('Biryani', '9'),
      n('Biryani', '4'),
      n('Fish', '2.5'),
      n('Tandoor', null),
      // A last-supplied date is not a count.
      { kind: 'DATE', value: '2026-09-20', is_done: true, section: 'Fish' },
    ]);
    expect(total).toBe(15.5);
    expect(bySection.get('Biryani')).toBe(13);
    expect(bySection.get('Fish')).toBe(2.5);
    expect(bySection.get('Tandoor')).toBe(0);
  });

  it('adds decimals without float dust', () => {
    expect(balanceTotals([n('Fish', '0.1'), n('Fish', '0.2')]).total).toBe(0.3);
  });
});
