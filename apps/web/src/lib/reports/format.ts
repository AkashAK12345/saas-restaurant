import type { ReportValueType } from './types';

/**
 * Turning a report value into text.
 *
 * SAMCO IS READ IN INDIA: numbers and amounts use Indian digit grouping
 * (1,00,000), dates print dd/MM/yyyy and times use the en-IN clock.
 *
 * MONEY ARRIVES IN INTEGER MINOR UNITS and is divided by 100 in exactly ONE
 * place on the frontend: `formatMoney` below. Nothing else in the web app
 * divides a stored amount, so a rounding bug has one home rather than one per
 * screen.
 *
 * DATES ARE ALREADY BRANCH-LOCAL. The server resolved every calendar date in
 * the branch's own timezone before the value left it; a `date` label is
 * re-ordered as text rather than being fed to `new Date()`, which would
 * re-apply the viewer's offset and move the day.
 */
const MINOR_UNITS_PER_MAJOR = 100;
const LOCALE = 'en-IN';

export function formatMoney(minor: number | string | null | undefined, currency?: string): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const amount = Number(minor) / MINOR_UNITS_PER_MAJOR;
  if (!Number.isFinite(amount)) return '—';
  if (currency) {
    try {
      return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(amount);
    } catch {
      // An unrecognised code is still a real amount; show it with the label.
      return `${amount.toFixed(2)} ${currency}`;
    }
  }
  return amount.toFixed(2);
}

/** Seconds as something a person reads at a glance. */
export function formatDuration(seconds: number | string | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const total = Math.round(Number(seconds));
  // A negative elapsed time is not a duration — it means a clock or a data
  // problem upstream. Printing "-35360s" on a dashboard would be worse than
  // admitting we have nothing to show.
  if (!Number.isFinite(total) || total < 0) return '—';
  if (total < 60) return `${total}s`;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

/** A branch-local calendar label ("2026-03-10") as dd/MM/yyyy, without parsing it. */
export function formatDateLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : label;
}

/** An instant, shown in the BRANCH's zone rather than the viewer's. */
export function formatInstant(value: unknown, timezone: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    const day = new Intl.DateTimeFormat(LOCALE, {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
    const time = new Intl.DateTimeFormat(LOCALE, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    return `${day}, ${time}`;
  } catch {
    return date.toISOString();
  }
}

export function formatValue(
  value: unknown,
  type: ReportValueType,
  options: { timezone: string; currency?: string } = { timezone: 'UTC' },
): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (type) {
    case 'money':
      return formatMoney(value as number, options.currency);
    case 'duration':
      return formatDuration(value as number);
    case 'percent':
      return `${Number(value)}%`;
    case 'number':
      return new Intl.NumberFormat(LOCALE).format(Number(value));
    case 'datetime':
      return formatInstant(value, options.timezone);
    case 'date':
      // Already a branch-local calendar date. Re-ordering the text is the
      // whole point; parsing it would shift the day for half the world.
      return formatDateLabel(String(value));
    default:
      return String(value);
  }
}

/** Numeric types line up better on the right. */
export function isNumericType(type: ReportValueType): boolean {
  return type === 'number' || type === 'money' || type === 'percent' || type === 'duration';
}

/** Today, in the branch's zone, as the YYYY-MM-DD the API expects. */
export function branchToday(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** `days` before the given branch-local date, as YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  // UTC arithmetic on a bare calendar date: no zone is involved, so none can
  // be applied by accident.
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}
