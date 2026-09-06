/**
 * Branch-local time utilities.
 *
 * CONVENTION — read this before writing any scheduled domain job:
 *
 *   Business schedules in SAMCO are expressed in the BRANCH'S timezone
 *   (`Branch.timezone`, an IANA name such as "Asia/Kolkata"), never in UTC
 *   and never in the server's local zone. "Every day at 09:00" for a Mumbai
 *   branch means 09:00 IST regardless of where the API process runs.
 *
 *   A job that evaluates "is it time yet?" must therefore:
 *     1. take the current instant (a UTC Date),
 *     2. project it into the branch timezone with these helpers,
 *     3. compare the branch-local date/time to the schedule.
 *
 *   The scheduler itself (JobRegistry) only decides HOW OFTEN a job wakes up;
 *   it knows nothing about branches. Per-branch "should this fire now" logic
 *   lives in the domain service the job calls, using the helpers below.
 *
 * These are intentionally thin wrappers over Intl — no timezone library, no
 * arithmetic on wall-clock times, no DST reasoning. A future Routines
 * implementation that needs "next occurrence" computation should add it
 * deliberately, with DST tests, rather than extend this file casually.
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** True for a valid IANA timezone identifier (the same check the Branch DTO uses). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface BranchLocalParts {
  /** ISO calendar date in the branch zone, e.g. "2026-09-07". */
  date: string;
  /** 24h wall-clock time in the branch zone, e.g. "09:05". */
  time: string;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, in the branch zone. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Project an instant into a branch's wall-clock. Throws on an invalid zone so
 * a bad Branch.timezone surfaces loudly rather than silently falling back to
 * the server zone.
 */
export function toBranchLocal(instant: Date, timeZone: string): BranchLocalParts {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }
  const map: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
    hour,
    minute,
    second,
    weekday: WEEKDAYS[map.weekday] ?? -1,
  };
}

/** Convenience: the branch-local calendar date ("service date") for an instant. */
export function branchLocalDate(instant: Date, timeZone: string): string {
  return toBranchLocal(instant, timeZone).date;
}
