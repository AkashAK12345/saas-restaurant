import { describe, it, expect } from 'vitest';
import { departmentRequests, itemCount, LEGACY } from './stock-request.report-provider.js';

const box = (section: string | null, value: string | null) => ({
  label: 'Items requested',
  section,
  kind: 'TEXT',
  value,
  is_done: value !== null,
});

describe('Stock Request report helpers', () => {
  it('counts one item per line, or per comma on a single line', () => {
    expect(itemCount('Rice 10kg\nOil 5L\n\nOnion 20kg')).toBe(3);
    expect(itemCount('Rice 10kg, Oil 5L; Onion 20kg')).toBe(3);
    expect(itemCount('1. Rice\n2) Oil\n- Salt')).toBe(3);
    expect(itemCount('  ')).toBe(0);
    expect(itemCount(null)).toBe(0);
  });

  it('lists the departments a request asked for; an unsplit request is Legacy', () => {
    expect(
      departmentRequests([
        box('Indian', 'Rice 10kg'),
        box('Chinese', null),
        box('BBQ', '  Charcoal  '),
        { label: 'Needed by', section: 'Request Details', kind: 'DATE', value: '2026-09-20', is_done: true },
      ]),
    ).toEqual([
      { department: 'Indian', items: 'Rice 10kg' },
      { department: 'BBQ', items: 'Charcoal' },
    ]);
    expect(departmentRequests([box(null, 'Old style request')])).toEqual([
      { department: LEGACY, items: 'Old style request' },
    ]);
  });
});
