import { BadRequestException } from '@nestjs/common';

/**
 * Money in the banquet domain.
 *
 * INTEGER MINOR UNITS ONLY. Every amount is a whole number of the currency's
 * minor unit (paise, cents). No float, no decimal string, no arithmetic that
 * can lose a fraction — the classic 0.1 + 0.2 problem never arises because
 * nothing is ever a fraction.
 *
 * CURRENCY is an explicit ISO 4217 alphabetic code carried on the package, the
 * booking snapshot and every payment. We validate the SHAPE (three uppercase
 * letters) rather than shipping the full ISO table: the code is a label the
 * operator chooses per package, and a stale embedded table would be a worse
 * lie than an honest format check. Cross-record consistency is what actually
 * matters, and that IS enforced: a payment must match its booking's currency.
 *
 * PRICE IS PER GUEST. A banquet package is quoted per plate, so a booking's
 * total is price_per_guest × guest_count, computed once and snapshotted. This
 * is a product decision the roadmap does not spell out; it is documented here,
 * mirrored in the schema comment, and covered by tests.
 *
 * This is NOT finance. There is no ledger, no journal, no accounting entry and
 * no refund path.
 */

/** Prisma `Int` is a 4-byte PostgreSQL integer. */
export const MAX_MINOR = 2_147_483_647;

/** Guard rails that keep a total inside MAX_MINOR for any sane event. */
export const MAX_PRICE_PER_GUEST_MINOR = 100_000_000; // 1,000,000.00 per guest
export const MAX_GUEST_COUNT = 10_000;

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

/** What is still owed. Derived from the booking total and its payments — never stored. */
export function balanceMinor(totalMinor: number, paidMinor: number): number {
  return totalMinor - paidMinor;
}

/** Sum of an append-only payment history. Integer addition only. */
export function sumPaidMinor(payments: ReadonlyArray<{ amount_minor: number }>): number {
  return payments.reduce((acc, p) => acc + p.amount_minor, 0);
}
