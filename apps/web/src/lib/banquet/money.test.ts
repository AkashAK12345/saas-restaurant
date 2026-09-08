import { describe, it, expect } from 'vitest';
import { formatMinor, minorUnitDigits, toMinor } from './money';

describe('banquet money', () => {
  describe('minorUnitDigits', () => {
    it('knows the common currencies', () => {
      expect(minorUnitDigits('INR')).toBe(2);
      expect(minorUnitDigits('USD')).toBe(2);
      expect(minorUnitDigits('JPY')).toBe(0);
    });

    it('falls back to 2 for an unknown code rather than crashing a screen', () => {
      expect(minorUnitDigits('ZZZ')).toBe(2);
      expect(minorUnitDigits('')).toBe(2);
    });
  });

  describe('formatMinor', () => {
    it('renders minor units as an amount', () => {
      expect(formatMinor(1_250_000, 'INR', 'en-IN')).toContain('12,500');
      expect(formatMinor(0, 'USD', 'en-US')).toBe('$0.00');
      expect(formatMinor(1, 'USD', 'en-US')).toBe('$0.01');
    });

    it('respects a zero-decimal currency', () => {
      expect(formatMinor(1250, 'JPY', 'en-US')).toBe('¥1,250');
    });

    it('degrades gracefully for an unknown code', () => {
      expect(formatMinor(1000, 'ZZZ')).toContain('10.00');
    });
  });

  describe('toMinor', () => {
    it.each([
      ['whole amount', '12500', 1_250_000],
      ['with decimals', '12500.50', 1_250_050],
      ['one decimal', '0.5', 50],
      ['zero', '0', 0],
      ['leading dot', '.75', 75],
      ['with thousands separators', '12,500.50', 1_250_050],
      ['padded', ' 100 ', 10_000],
    ])('parses %s', (_label, input, expected) => {
      expect(toMinor(input, 'INR')).toBe(expected);
    });

    it('parses the string rather than multiplying a float', () => {
      // 1.15 * 100 is 114.99999999999999 in IEEE-754; digit shifting is exact.
      expect(toMinor('1.15', 'USD')).toBe(115);
      expect(toMinor('8.29', 'USD')).toBe(829);
      expect(toMinor('1.005', 'USD')).toBeNull(); // more precision than USD has
    });

    it('respects a zero-decimal currency', () => {
      expect(toMinor('1250', 'JPY')).toBe(1250);
      expect(toMinor('1250.5', 'JPY')).toBeNull();
    });

    it.each([
      ['letters', 'abc'],
      ['currency symbol', '₹100'],
      ['negative', '-100'],
      ['empty', ''],
      ['just a dot', '.'],
      ['two dots', '1.2.3'],
      ['scientific', '1e3'],
    ])('rejects %s', (_label, input) => {
      expect(toMinor(input, 'INR')).toBeNull();
    });

    it('round-trips through formatMinor', () => {
      const minor = toMinor('12500.50', 'USD');
      expect(minor).toBe(1_250_050);
      expect(formatMinor(minor!, 'USD', 'en-US')).toBe('$12,500.50');
    });
  });
});
