import { describe, it, expect } from 'vitest';
import { dayLabel, windowDays } from './checklist-report.js';

describe('Branch Head Opening report helpers', () => {
  it('counts the window in days, both ends included', () => {
    expect(windowDays('2026-09-16', '2026-09-23')).toBe(8);
    expect(windowDays('2026-09-23', '2026-09-23')).toBe(1);
    // Across a month end, and a DST-free UTC count either way.
    expect(windowDays('2026-02-27', '2026-03-02')).toBe(4);
  });

  it('dates a row with its year', () => {
    expect(dayLabel('2026-09-23', true)).toBe('23 Sep 2026');
    expect(dayLabel('2026-09-23')).toBe('23 Sep');
  });
});
