/**
 * Date and time presentation for the staff screens.
 *
 * SAMCO is operated in India, so the display locale is en-IN: dates read
 * dd/MM/yyyy and times use the Indian 12-hour clock. Every instant is shown in
 * the BRANCH's timezone, never the device's — a manager reviewing a Bengaluru
 * branch from another city must see Bengaluru times, the same rule the server
 * applies to service dates and report ranges.
 *
 * Formatting only. Turning a typed wall clock into an instant is
 * lib/queue/branch-time.ts.
 */

export const APP_LOCALE = 'en-IN';

/** The device zone — only a fallback while the branch is still loading. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(d: Date, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(APP_LOCALE, { ...options, timeZone }).format(d);
  } catch {
    // An unknown zone must not blank a screen; show device time instead.
    return new Intl.DateTimeFormat(APP_LOCALE, options).format(d);
  }
}

/** dd/MM/yyyy in the branch zone, or '—'. */
export function formatDate(value: string | Date | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  return d ? format(d, timeZone, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

/** e.g. "7:30 pm" in the branch zone, or '—'. */
export function formatTime(value: string | Date | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  return d ? format(d, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

/** "dd/MM/yyyy, h:mm am" in the branch zone, or '—'. */
export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  return d ? `${formatDate(d, timeZone)}, ${formatTime(d, timeZone)}` : '—';
}

/**
 * A calendar label ("2028-03-15") as dd/MM/yyyy. No zone is involved: the
 * label already names a branch-local day.
 */
export function formatCalendarDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/** Short weekday for a calendar label, e.g. "Wed". */
export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat(APP_LOCALE, { weekday: 'short', timeZone: 'UTC' }).format(d);
}

/** Calendar arithmetic on a YYYY-MM-DD label — no wall clock involved. */
export function addCalendarDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar label at the branch. */
export function branchToday(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
