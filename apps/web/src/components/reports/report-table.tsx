import Link from 'next/link';
import { formatValue, isNumericType } from '@/lib/reports/format';
import type { ReportColumn, ReportDrilldown } from '@/lib/reports/types';
import styles from './reports.module.css';

/** A 'badge' column's raw value mapped to display text and a colour, per
 *  report and column — e.g. queue.tokens' `status` maps 'SEATED' to Seated /
 *  success. Absent for every column that isn't typed 'badge'. */
export interface BadgeSpec {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'primary' | 'neutral';
}

/**
 * A report's rows.
 *
 * Entirely column-driven: the table renders whatever the report declared and
 * formats each cell by its declared type. No report name appears in this file,
 * which is why a future module's report displays correctly the day it is
 * registered on the backend.
 *
 * DRILL-DOWN is declared by the report too: when the server names an id key
 * and a path, the first cell of each row opens that record. The linked screen
 * re-checks access itself — the link grants nothing.
 *
 * The table scrolls inside its own container so a wide report never makes the
 * whole page scroll sideways on a tablet.
 */
export function ReportTable({
  columns,
  rows,
  timezone,
  caption,
  drilldown,
  badges,
}: {
  columns: readonly ReportColumn[];
  rows: ReadonlyArray<Record<string, unknown>>;
  timezone: string;
  caption: string;
  drilldown?: ReportDrilldown | null;
  /** Column key -> raw value -> how to show it, for any 'badge' column. */
  badges?: Readonly<Record<string, Readonly<Record<string, BadgeSpec>>>>;
}) {
  if (rows.length === 0) {
    return (
      <p className={styles.empty} role="status">
        No data for this period.
      </p>
    );
  }

  const hrefFor = (row: Record<string, unknown>): string | null => {
    if (!drilldown) return null;
    const id = row[drilldown.id_key];
    return typeof id === 'string' && /^[A-Za-z0-9-]+$/.test(id) ? drilldown.path.replace(':id', id) : null;
  };

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={isNumericType(column.type) ? styles.numeric : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const href = hrefFor(row);
            return (
              // Reports are read-only aggregates with no stable identifier of
              // their own; the row's position in this result IS its identity.
              <tr key={index}>
                {columns.map((column, columnIndex) => {
                  const raw = row[column.key];
                  const badge = column.type === 'badge' ? badges?.[column.key]?.[String(raw)] : undefined;
                  // An unmapped badge value still shows as plain text rather
                  // than vanishing — a report gaining a new state word is a
                  // missing colour, not missing data.
                  const text = formatValue(raw, column.type, {
                    timezone,
                    currency: typeof row.currency === 'string' ? row.currency : undefined,
                  });
                  const content = badge ? (
                    <span className={styles.badge} data-tone={badge.tone}>
                      {badge.label}
                    </span>
                  ) : (
                    text
                  );
                  return (
                    <td
                      key={column.key}
                      className={isNumericType(column.type) ? styles.numeric : undefined}
                    >
                      {href && columnIndex === 0 ? <Link href={href}>{content}</Link> : content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
