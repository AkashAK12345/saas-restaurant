import { branchLocalDate } from '../../common/scheduler/branch-time.js';

/**
 * A queue "service date" is the calendar date IN THE BRANCH'S TIMEZONE on
 * which a token was issued. Token numbers restart at 1 for every branch on
 * every service date, so this — not the server's UTC date — is the partition
 * key for numbering. A Mumbai branch registering a party at 23:30 IST on the
 * 7th gets a token for the 7th even though it is 18:00 UTC.
 *
 * Wire format is always the ISO calendar date string "YYYY-MM-DD". The column
 * is a PostgreSQL DATE, which Prisma surfaces as a Date at UTC midnight; the
 * two helpers below are the only place that conversion happens.
 */
export const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real calendar date (rejects "2026-02-30"). */
export function isServiceDate(value: unknown): value is string {
  if (typeof value !== 'string' || !SERVICE_DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function serviceDateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function serviceDateFromDb(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The service date a token registered at `now` belongs to, for a branch in `timezone`. */
export function currentServiceDate(timezone: string, now: Date = new Date()): string {
  return branchLocalDate(now, timezone);
}
