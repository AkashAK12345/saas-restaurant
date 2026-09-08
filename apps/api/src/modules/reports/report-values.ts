/**
 * Coercions every report provider needs.
 *
 * PostgreSQL aggregates do not come back as JavaScript numbers. COUNT and
 * SUM(int) return bigint, and SUM(bigint) returns numeric — which Prisma hands
 * over as a Decimal object. Both serialise to JSON as strings, or throw, so a
 * provider that returned them raw would quietly change a metric's type
 * depending on which aggregate produced it.
 *
 * Everything a report emits as a number is therefore normalised here, in one
 * place, rather than each provider guessing.
 */
export function toReportNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  // Decimal, numeric-as-string, anything else numeric-shaped.
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A whole number of seconds, or null.
 *
 * Durations come out of Postgres as a float from EXTRACT(EPOCH ...) and are
 * genuinely absent when nothing was measured — an average wait over a day
 * where nobody was seated is not zero, and reporting it as zero would be a
 * lie. Null survives all the way to the UI, which prints a dash.
 */
export function toDurationSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * A DATE column (or a value already reduced to a branch-local day) as
 * YYYY-MM-DD. Postgres DATE has no zone, and Prisma presents it as midnight
 * UTC, so slicing the ISO string is the correct read — converting it would
 * introduce the very offset the column exists to avoid.
 */
export function toLocalDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
