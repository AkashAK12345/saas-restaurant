import { describe, it, expect } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  MAX_MINOR,
  activeAdjustments,
  assertCurrencyCode,
  balanceMinor,
  computeTotalMinor,
  gstHalfMinor,
  isCurrencyCode,
  isMinorAmount,
  paymentKindFor,
  paymentStatusOf,
  priceBooking,
  sumPaidMinor,
  type PricingAdjustment,
} from './banquet-money.js';

const adj = (
  id: string,
  kind: PricingAdjustment['kind'],
  amount_minor: number,
  reverses_id: string | null = null,
): PricingAdjustment => ({ id, kind, amount_minor, reverses_id });

describe('layered banquet pricing', () => {
  const base = { price_per_guest_minor: 125_000, guest_count: 80, extra_pax: 0, gst_rate_bps: 0, adjustments: [] };

  it('with nothing added is exactly price × guaranteed guests (no-GST mode)', () => {
    const inv = priceBooking(base);
    expect(inv.total_minor).toBe(10_000_000);
    expect(inv.taxable_minor).toBe(10_000_000);
    expect(inv.tax_minor).toBe(0);
  });

  it('charges extra pax at the same rate', () => {
    const inv = priceBooking({ ...base, extra_pax: 10 });
    expect(inv.extra_pax_minor).toBe(1_250_000);
    expect(inv.gross_minor).toBe(11_250_000);
  });

  it('builds the bill in the documented layers: charges, three discounts, then GST', () => {
    const inv = priceBooking({
      ...base,
      extra_pax: 20, // 100 plates
      gst_rate_bps: 500,
      adjustments: [
        adj('a', 'EXTRA_CHARGE', 500_000), // decoration
        adj('b', 'LINE_DISCOUNT', 100_000),
        adj('c', 'PER_HEAD_DISCOUNT', 1_000), // ₹10 × 100 plates
        adj('d', 'ADMIN_DISCOUNT', 250_000),
      ],
    });
    expect(inv.base_minor).toBe(10_000_000);
    expect(inv.extra_pax_minor).toBe(2_500_000);
    expect(inv.extra_charges_minor).toBe(500_000);
    expect(inv.gross_minor).toBe(13_000_000);
    expect(inv.per_head_discount_minor).toBe(100_000);
    expect(inv.discount_minor).toBe(450_000);
    expect(inv.taxable_minor).toBe(12_550_000);
    expect(inv.cgst_minor).toBe(313_750); // 2.5%
    expect(inv.sgst_minor).toBe(313_750);
    expect(inv.total_minor).toBe(12_550_000 + 627_500);
  });

  it('rounds each GST half half-up to a whole paisa, keeping CGST = SGST', () => {
    // 5% of 1001 paise = 50.05 → each half 25.025 → 25
    expect(gstHalfMinor(1001, 500)).toBe(25);
    // each half of 5% on 1010 = 25.25 → 25; on 1030 = 25.75 → 26
    expect(gstHalfMinor(1030, 500)).toBe(26);
    // exactly .5 rounds up: 2.5% of 20 = 0.5 → 1
    expect(gstHalfMinor(20, 500)).toBe(1);
    expect(gstHalfMinor(0, 500)).toBe(0);
    expect(gstHalfMinor(10_000, 0)).toBe(0);
    const inv = priceBooking({ ...base, price_per_guest_minor: 1001, guest_count: 1, gst_rate_bps: 500 });
    expect(inv.cgst_minor).toBe(inv.sgst_minor);
    expect(Number.isInteger(inv.total_minor)).toBe(true);
  });

  it('ignores a withdrawn line and its reversal', () => {
    const adjustments = [adj('a', 'ADMIN_DISCOUNT', 1_000_000), adj('r', 'ADMIN_DISCOUNT', 1_000_000, 'a')];
    expect(activeAdjustments(adjustments)).toEqual([]);
    expect(priceBooking({ ...base, adjustments }).total_minor).toBe(10_000_000);
  });

  it('refuses discounts larger than the bill — it can never owe the customer', () => {
    expect(() =>
      priceBooking({ ...base, adjustments: [adj('a', 'ADMIN_DISCOUNT', 10_000_001)] }),
    ).toThrow(ConflictException);
    // Exactly the whole value is allowed (a complimentary event).
    expect(priceBooking({ ...base, adjustments: [adj('a', 'ADMIN_DISCOUNT', 10_000_000)] }).total_minor).toBe(0);
  });

  it.each([
    ['negative extra pax', { extra_pax: -1 }],
    ['fractional extra pax', { extra_pax: 1.5 }],
    ['a negative GST rate', { gst_rate_bps: -1 }],
    ['a GST rate above 28%', { gst_rate_bps: 2801 }],
  ])('rejects %s', (_label, over) => {
    expect(() => priceBooking({ ...base, ...over })).toThrow(BadRequestException);
  });

  it('refuses a bill that would not fit the column instead of overflowing', () => {
    expect(() =>
      priceBooking({ ...base, price_per_guest_minor: 100_000_000, guest_count: 20, extra_pax: 10 }),
    ).toThrow(BadRequestException);
  });

  it('derives payment status and the settlement stage of a new payment', () => {
    expect(paymentStatusOf(1000, 0)).toBe('UNPAID');
    expect(paymentStatusOf(1000, 1)).toBe('PARTIAL');
    expect(paymentStatusOf(1000, 1000)).toBe('PAID');
    expect(paymentStatusOf(0, 0)).toBe('PAID');

    expect(paymentKindFor(0, 100, 1000)).toBe('ADVANCE');
    expect(paymentKindFor(100, 100, 1000)).toBe('INTERIM');
    expect(paymentKindFor(900, 100, 1000)).toBe('FINAL');
    expect(paymentKindFor(0, 1000, 1000)).toBe('FINAL');
  });
});

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
