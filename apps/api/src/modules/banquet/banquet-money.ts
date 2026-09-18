import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Money in the banquet domain.
 *
 * INTEGER MINOR UNITS ONLY. Every amount is a whole number of the currency's
 * minor unit (paise, cents). No float, no decimal string, no arithmetic that
 * can lose a fraction — the classic 0.1 + 0.2 problem never arises because
 * nothing is ever a fraction. The one division in the domain (a tax rate) is
 * done on integers with an explicit rounding rule.
 *
 * CURRENCY is an explicit ISO 4217 alphabetic code carried on the package, the
 * booking snapshot and every payment. We validate the SHAPE (three uppercase
 * letters) rather than shipping the full ISO table: the code is a label the
 * operator chooses per package, and a stale embedded table would be a worse
 * lie than an honest format check. Cross-record consistency is what actually
 * matters, and that IS enforced: a payment must match its booking's currency.
 *
 * PRICE IS PER GUEST. A banquet package is quoted per plate. The bill is built
 * in layers (priceBooking below), matching the reference product:
 *
 *     base            = rate × guaranteed guests
 *   + extra pax       = rate × guests over the guarantee
 *   + extra charges   (decoration, DJ, extra service)
 *   − line discounts
 *   − per-head discount × every plate
 *   − admin discount  (lump-sum override)
 *   = taxable value
 *   + CGST + SGST     (each half the GST rate; 0% is no-GST mode)
 *   = bill total
 *
 * This is NOT finance. There is no ledger, no journal, no accounting entry and
 * no refund path.
 */

/** Prisma `Int` is a 4-byte PostgreSQL integer. */
export const MAX_MINOR = 2_147_483_647;

/** Guard rails that keep a total inside MAX_MINOR for any sane event. */
export const MAX_PRICE_PER_GUEST_MINOR = 100_000_000; // 1,000,000.00 per guest
export const MAX_GUEST_COUNT = 10_000;

/** Highest GST slab in India is 28%; the database CHECK uses the same bound. */
export const MAX_GST_RATE_BPS = 2800;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

export function assertCurrencyCode(value: unknown): string {
  if (!isCurrencyCode(value)) {
    throw new BadRequestException('currency must be a 3-letter ISO 4217 code, e.g. INR');
  }
  return value;
}

/** A whole, non-negative amount that fits the column. */
export function isMinorAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_MINOR
  );
}

/**
 * price_per_guest × guests, rejected rather than silently truncated if the
 * product would not fit the column.
 */
export function computeTotalMinor(pricePerGuestMinor: number, guestCount: number): number {
  if (!Number.isSafeInteger(pricePerGuestMinor) || pricePerGuestMinor < 0) {
    throw new BadRequestException('price_per_guest_minor must be a whole, non-negative amount');
  }
  if (!Number.isSafeInteger(guestCount) || guestCount < 1) {
    throw new BadRequestException('guest_count must be a whole number of at least 1');
  }
  const total = pricePerGuestMinor * guestCount;
  if (total > MAX_MINOR) {
    throw new BadRequestException('The total for this booking is larger than the system supports');
  }
  return total;
}

/** What is still owed. */
export function balanceMinor(totalMinor: number, paidMinor: number): number {
  return totalMinor - paidMinor;
}

/** Sum of a payment history. Integer addition only — callers pass whichever rows should count. */
export function sumPaidMinor(payments: ReadonlyArray<{ amount_minor: number }>): number {
  return payments.reduce((acc, p) => acc + p.amount_minor, 0);
}

/**
 * The payments still in force: correcting one (see BanquetBookingsService.
 * updatePayment) reverses it and records a fresh one, the same reversing
 * pattern as an adjustment's withdrawal — a reversing row and the row it
 * reverses cancel out and neither counts toward paid_minor.
 */
export function activePayments<T extends { id: string; reverses_id: string | null }>(
  payments: ReadonlyArray<T>,
): T[] {
  const reversed = new Set(payments.map((p) => p.reverses_id).filter((id): id is string => !!id));
  return payments.filter((p) => p.reverses_id === null && !reversed.has(p.id));
}

// ── Layered pricing ──────────────────────────────────────────────────────────

export type BanquetAdjustmentKindName =
  | 'EXTRA_CHARGE'
  | 'LINE_DISCOUNT'
  | 'PER_HEAD_DISCOUNT'
  | 'ADMIN_DISCOUNT';

export interface PricingAdjustment {
  id: string;
  kind: BanquetAdjustmentKindName;
  amount_minor: number;
  reverses_id: string | null;
}

export interface PricingInput {
  price_per_guest_minor: number;
  guest_count: number;
  extra_pax: number;
  gst_rate_bps: number;
  adjustments: ReadonlyArray<PricingAdjustment>;
}

export interface BanquetInvoice {
  base_minor: number;
  extra_pax_minor: number;
  extra_charges_minor: number;
  /** base + extra pax + extra charges */
  gross_minor: number;
  line_discount_minor: number;
  per_head_discount_minor: number;
  admin_discount_minor: number;
  discount_minor: number;
  taxable_minor: number;
  gst_rate_bps: number;
  cgst_minor: number;
  sgst_minor: number;
  tax_minor: number;
  total_minor: number;
}

/**
 * The lines still in force: a reversing row and the row it reverses cancel
 * each other out, so neither is priced.
 */
export function activeAdjustments<T extends PricingAdjustment>(adjustments: ReadonlyArray<T>): T[] {
  const reversed = new Set(adjustments.map((a) => a.reverses_id).filter((id): id is string => !!id));
  return adjustments.filter((a) => a.reverses_id === null && !reversed.has(a.id));
}

/**
 * One half of GST (CGST or SGST) on a taxable value: taxable × rate / 2,
 * rounded half-up to a whole minor unit. Each half is rounded on its own, the
 * way an Indian tax invoice prints them, so CGST and SGST are always equal.
 *
 * Exact in integers: taxable ≤ 2^31 and rate ≤ 2800 keep the product far below
 * 2^53.
 */
export function gstHalfMinor(taxableMinor: number, gstRateBps: number): number {
  return Math.floor((taxableMinor * gstRateBps + 10_000) / 20_000);
}

function checked(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value > MAX_MINOR) {
    throw new BadRequestException(`The ${what} for this booking is larger than the system supports`);
  }
  return value;
}

/**
 * Price a booking from its snapshot inputs. Pure: the service calls it inside
 * the booking's locked transaction and stores total_minor.
 *
 * Discounts may reduce the taxable value to zero but never below it — a bill
 * cannot owe the customer money (there is no refund path).
 */
export function priceBooking(input: PricingInput): BanquetInvoice {
  if (!Number.isSafeInteger(input.extra_pax) || input.extra_pax < 0) {
    throw new BadRequestException('extra_pax must be a whole, non-negative number');
  }
  if (
    !Number.isSafeInteger(input.gst_rate_bps) ||
    input.gst_rate_bps < 0 ||
    input.gst_rate_bps > MAX_GST_RATE_BPS
  ) {
    throw new BadRequestException(`gst_rate_bps must be between 0 and ${MAX_GST_RATE_BPS}`);
  }

  const base = computeTotalMinor(input.price_per_guest_minor, input.guest_count);
  const extraPax = checked(input.price_per_guest_minor * input.extra_pax, 'extra pax charge');
  const plates = input.guest_count + input.extra_pax;

  let extraCharges = 0;
  let line = 0;
  let perHead = 0;
  let admin = 0;
  for (const a of activeAdjustments(input.adjustments)) {
    switch (a.kind) {
      case 'EXTRA_CHARGE':
        extraCharges += a.amount_minor;
        break;
      case 'LINE_DISCOUNT':
        line += a.amount_minor;
        break;
      case 'PER_HEAD_DISCOUNT':
        perHead += a.amount_minor * plates;
        break;
      case 'ADMIN_DISCOUNT':
        admin += a.amount_minor;
        break;
    }
  }

  const gross = checked(base + extraPax + checked(extraCharges, 'extra charges'), 'bill');
  const discount = checked(line + perHead + admin, 'discount');
  if (discount > gross) {
    throw new ConflictException(
      `Discounts of ${discount} would exceed the booking value of ${gross}`,
    );
  }
  const taxable = gross - discount;
  const cgst = gstHalfMinor(taxable, input.gst_rate_bps);
  const sgst = cgst;
  const tax = cgst + sgst;

  return {
    base_minor: base,
    extra_pax_minor: extraPax,
    extra_charges_minor: extraCharges,
    gross_minor: gross,
    line_discount_minor: line,
    per_head_discount_minor: perHead,
    admin_discount_minor: admin,
    discount_minor: discount,
    taxable_minor: taxable,
    gst_rate_bps: input.gst_rate_bps,
    cgst_minor: cgst,
    sgst_minor: sgst,
    tax_minor: tax,
    total_minor: checked(taxable + tax, 'bill total'),
  };
}

export type BanquetPaymentStatusName = 'UNPAID' | 'PARTIAL' | 'PAID';

/** Pending / partial / paid, from the stored total and paid amounts. */
export function paymentStatusOf(totalMinor: number, paidMinor: number): BanquetPaymentStatusName {
  if (paidMinor <= 0) return totalMinor === 0 ? 'PAID' : 'UNPAID';
  return paidMinor >= totalMinor ? 'PAID' : 'PARTIAL';
}

/**
 * The settlement stage a new payment represents, decided by the server when
 * it is recorded: the first is the advance, the one that clears the balance is
 * final, anything between is interim. A single payment of the whole amount is
 * FINAL.
 */
export function paymentKindFor(
  paidBeforeMinor: number,
  amountMinor: number,
  totalMinor: number,
): 'ADVANCE' | 'INTERIM' | 'FINAL' {
  if (paidBeforeMinor + amountMinor >= totalMinor) return 'FINAL';
  return paidBeforeMinor === 0 ? 'ADVANCE' : 'INTERIM';
}
