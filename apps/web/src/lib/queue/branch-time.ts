/**
 * Turning a branch-local wall clock into an instant.
 *
 * A `datetime-local` input yields "2026-09-09T19:30" — a wall clock with no
 * zone. `new Date(that)` reads it in the DEVICE's zone, which is wrong the
 * moment a manager in London books a table for a branch in Bengaluru: the
 * booking lands four and a half hours out, silently.
 *
 * So the wall clock is interpreted in the BRANCH's zone, the same rule the
 * server applies to every service date and report range.
 *
 * The method: guess that the wall clock is UTC, ask what that instant looks
 * like in the branch's zone, and correct by the difference. One correction is
 * enough for every real offset; a second pass settles the rare case where the
 * first correction lands on the other side of a DST transition.
 */
function zonedOffsetMs(instant: Date, timeZone: string): number {
  // `en-CA` gives YYYY-MM-DD, and hourCycle h23 keeps midnight as 00, not 24.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * `local` is "YYYY-MM-DDTHH:mm" (what a datetime-local input produces).
 * Returns the instant that wall clock names in `timeZone`, or null if the
 * value is not a usable wall clock.
 */
export function branchLocalToInstant(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!match) return null;

  const [, y, mo, d, h, mi, sec] = match;
  const guess = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec ?? '0'),
  );
  if (Number.isNaN(guess)) return null;

  try {
    let instant = new Date(guess - zonedOffsetMs(new Date(guess), timeZone));
    // Second pass: if the first correction crossed a DST boundary the offset
    // it used was the wrong side's. Re-measuring from the corrected instant
    // fixes it, and converges for every real zone.
    instant = new Date(guess - zonedOffsetMs(instant, timeZone));
    return Number.isNaN(instant.getTime()) ? null : instant;
  } catch {
    return null;
  }
}

/** The wall clock, in the branch's zone, that a datetime-local input wants. */
export function instantToBranchLocal(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(instant);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}
