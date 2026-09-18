/**
 * The dashboard greeting.
 *
 * BRANCH TIME, NOT DEVICE TIME. "Good morning" has to agree with the branch a
 * user is looking at: a manager checking the Bengaluru branch from London
 * should be greeted by Bengaluru's clock, and the date underneath must be the
 * branch's day — the same rule every report and every service date follows.
 */
export type PartOfDay = 'morning' | 'afternoon' | 'evening';

/** The hour, 0–23, in the given IANA zone. */
export function branchHour(timezone: string, now: Date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now);
    // "24" is a legal en-GB rendering of midnight; it means hour 0.
    return Number(hour) % 24;
  } catch {
    return now.getHours();
  }
}

export function partOfDay(timezone: string, now: Date = new Date()): PartOfDay {
  const hour = branchHour(timezone, now);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const LABEL: Record<PartOfDay, string> = {
  morning: 'Good Morning',
  afternoon: 'Good Afternoon',
  evening: 'Good Evening',
};

export function greetingFor(timezone: string, now: Date = new Date()): string {
  return LABEL[partOfDay(timezone, now)];
}

/**
 * "Wednesday, 16 September", in the branch's own day.
 *
 * The locale is pinned to en-GB for DAY-BEFORE-MONTH order, which is what the
 * product's design calls for and what most of its markets read. The viewer's
 * own locale is used everywhere a number or currency is shown; only this one
 * decorative header line is fixed, so the greeting cannot flip to "September
 * 16" on a US-configured tablet. The comma after the weekday is added here:
 * en-GB does not print one, and the design asks for it.
 */
export function branchDateLabel(timezone: string, now: Date = new Date()): string {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', options).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format({ timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    parts = format({ weekday: 'long', day: 'numeric', month: 'long' });
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('day')} ${get('month')}`;
}
