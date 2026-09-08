import { BadRequestException } from '@nestjs/common';
import {
  branchLocalDate,
  branchLocalToInstant,
} from '../../common/scheduler/branch-time.js';
import type { ReportRange } from './report-contract.js';

/**
 * Turning the dates a user typed into the instants a query needs.
 *
 * BRANCH-LOCAL IS AUTHORITATIVE. "1–8 September" means those calendar days in
 * the branch's own timezone, not UTC and not the server's zone. A Mumbai
 * branch's 1 September starts at 18:30 UTC on 31 August, and the query must
 * say so — otherwise every report silently misattributes five and a half
 * hours of trade to the wrong day.
 *
 * DST is handled by construction rather than by special cases: both
 * boundaries are resolved through the T0-C helpers, so a 23- or 25-hour day
 * produces a window of exactly that length. The window is HALF-OPEN
 * [from, to) — the end is midnight at the START of the day after `to`, which
 * is why a single-day range still covers the whole day.
 *
 * MAXIMUM RANGE: 366 days. Long enough for "the last year", short enough that
 * no report can be asked to scan an unbounded history. Documented here, in the
 * error message, and in the tests.
 */
export const MAX_REPORT_RANGE_DAYS = 366;
export const DEFAULT_REPORT_RANGE_DAYS = 30;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A well-formed, real calendar date (rejects "2026-02-30"). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Resolve a requested window against a branch's timezone.
 *
 * Defaults to the last DEFAULT_REPORT_RANGE_DAYS days ending today, in the
 * branch's own calendar — so "no filter" still means something sensible at
 * every branch on the platform.
 */
export function resolveReportRange(
  timezone: string,
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): ReportRange {
  const today = branchLocalDate(now, timezone);

  const toLocal = to ?? today;
  const fromLocal = from ?? addDays(toLocal, -(DEFAULT_REPORT_RANGE_DAYS - 1));

  if (!isCalendarDate(fromLocal)) {
    throw new BadRequestException('from must be a valid calendar date (YYYY-MM-DD)');
  }
  if (!isCalendarDate(toLocal)) {
    throw new BadRequestException('to must be a valid calendar date (YYYY-MM-DD)');
  }
  if (fromLocal > toLocal) {
    throw new BadRequestException('from must not be after to');
  }

  const days = daysBetween(fromLocal, toLocal);
  if (days > MAX_REPORT_RANGE_DAYS) {
    throw new BadRequestException(
      `A report may cover at most ${MAX_REPORT_RANGE_DAYS} days; that range is ${days}`,
    );
  }

  return {
    // Midnight at the start of `from`, branch-local.
    from: branchLocalToInstant(fromLocal, '00:00', timezone),
    // Midnight at the start of the NEXT day, so `to` is fully included.
    to: branchLocalToInstant(addDays(toLocal, 1), '00:00', timezone),
    fromLocal,
    toLocal,
    days,
  };
}

/** Every branch-local date in the window, oldest first. For per-day series. */
export function eachLocalDate(range: ReportRange): string[] {
  const out: string[] = [];
  for (let d = range.fromLocal; d <= range.toLocal; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The branch-local calendar date an instant falls on. */
export function localDateOf(instant: Date, timezone: string): string {
  return branchLocalDate(instant, timezone);
}
