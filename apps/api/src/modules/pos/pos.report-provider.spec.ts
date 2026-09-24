import { describe, it, expect } from 'vitest';
import { averageMinor, hourLabel, successRate } from './pos.report-provider.js';

describe('POS report helpers', () => {
  it('names an hour of the day on a 12-hour clock', () => {
    expect(hourLabel(0)).toBe('12 AM');
    expect(hourLabel(9)).toBe('9 AM');
    expect(hourLabel(12)).toBe('12 PM');
    expect(hourLabel(19)).toBe('7 PM');
  });

  it('averages the bill over paid orders only, in whole minor units', () => {
    expect(averageMinor(100_050, 3)).toBe(33_350);
    expect(averageMinor(0, 0)).toBe(0);
  });

  it('reads the success rate as paid over every order, 0 with none', () => {
    expect(successRate(3, 4)).toBe(75);
    expect(successRate(0, 0)).toBe(0);
  });
});
