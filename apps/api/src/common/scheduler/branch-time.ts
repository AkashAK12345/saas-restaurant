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

/**
 * The INVERSE of toBranchLocal: the instant at which a given branch-local
 * wall-clock date and time occurs.
 *
 * Added for Phase 9 routines, which are defined in branch-local terms ("every
 * Monday at 09:00") and must be turned into real instants to be scheduled and
 * compared. It belongs here, beside its inverse, rather than in a second
 * timezone implementation.
 *
 * DST — the two awkward cases, decided explicitly rather than left to chance:
 *
 *   SKIPPED time (spring forward). 02:30 simply does not exist in New York on
 *     the day the clocks jump 02:00 → 03:00. We return the first instant AFTER
 *     the gap (i.e. 03:00 local), so a routine still runs that day rather than
 *     silently vanishing.
 *
 *   REPEATED time (fall back). 01:30 happens twice. We return the FIRST
 *     occurrence — the earlier instant. A routine fires once, on the first
 *     pass, and the occurrence key (branch-local date) keeps it single anyway.
 *
 * Method: guess by reading the wall clock as if it were UTC, correct by the
 * offset actually in force near that moment, then verify by projecting back.
 * No offset is ever hard-coded and no arithmetic is done on wall-clock values.
 */
export function branchLocalToInstant(date: string, time: string, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError(`Invalid branch-local date: ${date}`);
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new RangeError(`Invalid branch-local time: ${time}`);
  }

  const asIfUtc = Date.parse(`${date}T${time}:00.000Z`);
  if (Number.isNaN(asIfUtc)) {
    throw new RangeError(`Invalid branch-local date/time: ${date} ${time}`);
  }

  /** How far the zone is ahead of UTC at a given instant, in milliseconds. */
  const offsetAt = (instant: number): number => {
    const local = toBranchLocal(new Date(instant), timeZone);
    const asUtc = Date.parse(
      `${local.date}T${local.time}:${String(local.second).padStart(2, '0')}.000Z`,
    );
    return asUtc - instant;
  };

  // One correction is enough for a stable offset; a second handles the case
  // where the first guess landed on the other side of a transition.
  const first = asIfUtc - offsetAt(asIfUtc);
  const candidate = asIfUtc - offsetAt(first);

  const round = toBranchLocal(new Date(candidate), timeZone);
  if (round.date === date && round.time === time) return new Date(candidate);

  // The wall-clock time does not exist (spring forward): the candidate landed
  // before the gap. Walking forward in 15-minute steps reaches the first real
  // instant at or after the requested time without assuming the gap's size.
  for (let step = 1; step <= 8; step++) {
    const shifted = candidate + step * 15 * 60_000;
    const parts = toBranchLocal(new Date(shifted), timeZone);
    if (parts.date > date || (parts.date === date && parts.time >= time)) {
      return new Date(shifted);
    }
  }
  return new Date(candidate);
}
