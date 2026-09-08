import { RoutineFrequency } from '@samco/database';
import { branchLocalToInstant, toBranchLocal } from '../../common/scheduler/branch-time.js';

/**
 * Turning a routine definition into concrete occurrences.
 *
 * A routine is defined in BRANCH-LOCAL terms — "every Monday at 09:00" means
 * 09:00 in that branch's own timezone, on the branch's own calendar. This
 * module is the only place that reasoning happens; it delegates every actual
 * timezone conversion to the T0-C helpers in branch-time.ts.
 *
 * OCCURRENCE IDENTITY is the branch-local calendar DATE. That is what makes
 * materialization idempotent and DST-proof at the same time:
 *   - the database key is (routine_id, routine_occurrence_date),
 *   - a day is a day regardless of whether it happens to be 23 or 25 hours
 *     long, so a clock change can never produce two occurrences or skip one.
 * The instant a task is scheduled FOR is derived from that date, and is the
 * value DST actually shifts.
 */

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value);
}

export interface RoutineSchedule {
  frequency: RoutineFrequency;
  /** Branch-local wall clock, "HH:MM". */
  timeOfDay: string;
  /** WEEKLY only: 0 = Sunday … 6 = Saturday, branch-local. */
  weekdays: readonly number[];
}

export interface RoutineOccurrence {
  /** Branch-local calendar date, "YYYY-MM-DD". The idempotency key. */
  date: string;
  /** The absolute instant that date and time falls at in the branch zone. */
  scheduledFor: Date;
}

export function isValidWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/** Does the routine run on this branch-local date at all? */
export function occursOn(schedule: RoutineSchedule, date: string, timeZone: string): boolean {
  if (schedule.frequency === RoutineFrequency.DAILY) return true;
  // Read the weekday from the branch's own calendar, not the server's.
  const weekday = toBranchLocal(branchLocalToInstant(date, '12:00', timeZone), timeZone).weekday;
  return schedule.weekdays.includes(weekday);
}

/** Add whole days to a "YYYY-MM-DD" string. Calendar arithmetic only — no zones. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every occurrence of `schedule` that is DUE at `now` — that is, whose
 * scheduled instant has already passed — looking back at most `lookbackDays`
 * branch-local days.
 *
 * The look-back is deliberate and bounded: a routine that has been dormant for
 * a month should not suddenly materialise thirty tasks the first time anyone
 * opens the dashboard. It catches up over the recent window and no further.
 *
 * Returned oldest first, so tasks are created in the order they were due.
 */
export function dueOccurrences(
  schedule: RoutineSchedule,
  timeZone: string,
  now: Date,
  lookbackDays: number,
): RoutineOccurrence[] {
  const today = toBranchLocal(now, timeZone).date;
  const out: RoutineOccurrence[] = [];

  for (let back = lookbackDays; back >= 0; back--) {
    const date = addDays(today, -back);
    if (!occursOn(schedule, date, timeZone)) continue;

    const scheduledFor = branchLocalToInstant(date, schedule.timeOfDay, timeZone);
    // Not yet due: today's 18:00 routine is not materialised at 09:00.
    if (scheduledFor.getTime() > now.getTime()) continue;

    out.push({ date, scheduledFor });
  }
  return out;
}

/** The next occurrence at or after `now`, for showing an operator what comes next. */
export function nextOccurrence(
  schedule: RoutineSchedule,
  timeZone: string,
  now: Date,
  horizonDays = 14,
): RoutineOccurrence | null {
  const today = toBranchLocal(now, timeZone).date;
  for (let ahead = 0; ahead <= horizonDays; ahead++) {
    const date = addDays(today, ahead);
    if (!occursOn(schedule, date, timeZone)) continue;
    const scheduledFor = branchLocalToInstant(date, schedule.timeOfDay, timeZone);
    if (scheduledFor.getTime() >= now.getTime()) return { date, scheduledFor };
  }
  return null;
}
