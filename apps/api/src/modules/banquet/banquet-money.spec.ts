import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  MAX_MINOR,
  assertCurrencyCode,
  balanceMinor,
  computeTotalMinor,
  isCurrencyCode,
  isMinorAmount,
  sumPaidMinor,
} from './banquet-money.js';

describe('banquet money', () => {
  describe('currency', () => {
    it.each(['INR', 'USD', 'EUR', 'AED'])('accepts %s', (c) => {
      expect(isCurrencyCode(c)).toBe(true);
      expect(assertCurrencyCode(c)).toBe(c);
    });

    it.each([
      ['lowercase', 'inr'],
      ['mixed case', 'Inr'],
      ['too short', 'IN'],
      ['too long', 'INRX'],
      ['digits', '123'],
      ['symbol', '₹'],
      ['empty', ''],
      ['spaces', ' INR '],
    ])('rejects %s', (_label, c) => {
      expect(isCurrencyCode(c)).toBe(false);
      expect(() => assertCurrencyCode(c)).toThrow(BadRequestException);
    });

    it.each([[null], [undefined], [123], [{}]])('rejects the non-string %s', (c) => {
      expect(isCurrencyCode(c)).toBe(false);
    });
  });

  describe('minor amounts', () => {
    it.each([0, 1, 100, 999_999, MAX_MINOR])('accepts %s', (n) => {
      expect(isMinorAmount(n)).toBe(true);
    });

    it.each([
      ['negative', -1],
      ['fractional', 10.5],
      ['a hair over an integer', 100.000001],
      ['beyond the column', MAX_MINOR + 1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects %s', (_label, n) => {
      expect(isMinorAmount(n)).toBe(false);
    });

    it('rejects a decimal string — money is never text here', () => {
      expect(isMinorAmount('1000')).toBe(false);
      expect(isMinorAmount('10.00')).toBe(false);
    });
  });

  describe('computeTotalMinor', () => {
    it('multiplies price per guest by the head count', () => {
      expect(computeTotalMinor(125_000, 80)).toBe(10_000_000); // ₹1,250 × 80 = ₹100,000
      expect(computeTotalMinor(0, 50)).toBe(0);
      expect(computeTotalMinor(1, 1)).toBe(1);
    });

    it('stays exact where floating point would not', () => {
      // 0.1 + 0.2 style drift is impossible: these are whole paise.
      const total = computeTotalMinor(10, 3);
      expect(total).toBe(30);
      expect(Number.isInteger(total)).toBe(true);
    });

    it.each([
      ['fractional price', 10.5, 2],
      ['negative price', -1, 2],
      ['zero guests', 100, 0],
      ['negative guests', 100, -3],
      ['fractional guests', 100, 2.5],
    ])('rejects %s', (_label, price, guests) => {
      expect(() => computeTotalMinor(price, guests)).toThrow(BadRequestException);
    });

    it('refuses a total that would not fit the column rather than truncating', () => {
      expect(() => computeTotalMinor(100_000_000, 10_000)).toThrow(BadRequestException);
      expect(computeTotalMinor(MAX_MINOR, 1)).toBe(MAX_MINOR);
    });
  });

  describe('balance', () => {
    it('is total minus what has been paid', () => {
      expect(balanceMinor(10_000_000, 0)).toBe(10_000_000);
      expect(balanceMinor(10_000_000, 2_500_000)).toBe(7_500_000);
      expect(balanceMinor(10_000_000, 10_000_000)).toBe(0);
    });

    it('sums an append-only history exactly', () => {
      const payments = [
        { amount_minor: 2_500_000 },
        { amount_minor: 100 },
        { amount_minor: 7_499_900 },
      ];
      expect(sumPaidMinor(payments)).toBe(10_000_000);
      expect(balanceMinor(10_000_000, sumPaidMinor(payments))).toBe(0);
    });

    it('sums an empty history to zero', () => {
      expect(sumPaidMinor([])).toBe(0);
    });

    it('never produces a fraction across many small payments', () => {
      const payments = Array.from({ length: 300 }, () => ({ amount_minor: 33 }));
      const paid = sumPaidMinor(payments);
      expect(paid).toBe(9_900);
      expect(Number.isInteger(paid)).toBe(true);
      expect(Number.isInteger(balanceMinor(10_000, paid))).toBe(true);
    });
  });
});
