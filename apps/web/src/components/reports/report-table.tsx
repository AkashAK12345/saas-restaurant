import { formatValue, isNumericType } from '@/lib/reports/format';
import type { ReportColumn } from '@/lib/reports/types';
import styles from './reports.module.css';

/**
 * A report's rows.
 *
 * Entirely column-driven: the table renders whatever the report declared and
 * formats each cell by its declared type. No report name appears in this file,
 * which is why a future module's report displays correctly the day it is
 * registered on the backend.
 *
 * The table scrolls inside its own container so a wide report never makes the
 * whole page scroll sideways on a tablet.
 */
export function ReportTable({
  columns,
  rows,
  timezone,
  caption,
}: {
  columns: readonly ReportColumn[];
  rows: ReadonlyArray<Record<string, unknown>>;
  timezone: string;
  caption: string;
}) {
  if (rows.length === 0) {
    return (
      <p className={styles.empty} role="status">
        No data for this period.
      </p>
    );
  }

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
          {rows.map((row, index) => (
            // Reports are read-only aggregates with no stable identifier of
            // their own; the row's position in this result IS its identity.
            <tr key={index}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={isNumericType(column.type) ? styles.numeric : undefined}
                >
                  {formatValue(row[column.key], column.type, {
                    timezone,
                    currency: typeof row.currency === 'string' ? row.currency : undefined,
                  })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
