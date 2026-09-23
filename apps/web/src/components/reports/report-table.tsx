import Link from 'next/link';
import { AppIcon } from '@/components/app/icons';
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
  amountTones,
  valuePills,
  emptyVariant = 'plain',
  emptyText = 'No data found',
  stickyFirstColumn = false,
  wrapCells = false,
  boldFirstColumn = false,
  textTones,
}: {
  columns: readonly ReportColumn[];
  rows: ReadonlyArray<Record<string, unknown>>;
  timezone: string;
  caption: string;
  drilldown?: ReportDrilldown | null;
  /** Column key -> raw value -> how to show it, for any 'badge' column. */
  badges?: Readonly<Record<string, Readonly<Record<string, BadgeSpec>>>>;
  /** Column key -> a money value's colour by sign — e.g. a balance still
   *  owed in red, overpaid in green. Plain black for anything unmapped. */
  amountTones?: Readonly<Record<string, (value: number) => 'success' | 'danger' | undefined>>;
  /** Column key -> a numeric value shown as a coloured pill, e.g. a
   *  compliance rate. */
  valuePills?: Readonly<Record<string, (value: number) => BadgeSpec['tone'] | undefined>>;
  /** 'panel' when the table sits inside a titled panel that already frames
   *  it — an icon and a line instead of a second bordered box. */
  emptyVariant?: 'plain' | 'panel';
  /** The panel empty state's line, when "No data found" would not say why. */
  emptyText?: string;
  /** Keep the first column in view while the rest scroll sideways — for a
   *  transposed grid, whose first column names each row. */
  stickyFirstColumn?: boolean;
  /** Let long free text wrap (and keep its line breaks) in fixed-width
   *  columns, instead of one line per cell. */
  wrapCells?: boolean;
  /** Set the first column in bold — a row's name, e.g. the staff member. */
  boldFirstColumn?: boolean;
  /** Column key -> a colour for any cell's text by its raw value, e.g. a
   *  missed count in red once it is above zero. */
  textTones?: Readonly<Record<string, (value: unknown) => 'success' | 'danger' | undefined>>;
}) {
  if (rows.length === 0) {
    return emptyVariant === 'panel' ? (
      <div className={styles.panelEmpty} role="status">
        <span className={styles.panelEmptyIcon} aria-hidden="true">
          <AppIcon name="inbox" size={30} />
        </span>
        <p>{emptyText}</p>
      </div>
    ) : (
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
      <table
        className={[
          styles.table,
          stickyFirstColumn ? styles.stickyFirst : '',
          wrapCells ? styles.wrapCells : '',
          boldFirstColumn ? styles.boldFirst : '',
        ].join(' ')}
      >
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
                  const amountTone =
                    column.type === 'money' && typeof raw === 'number'
                      ? amountTones?.[column.key]?.(raw)
                      : undefined;
                  const pillTone = typeof raw === 'number' ? valuePills?.[column.key]?.(raw) : undefined;
                  const textTone = amountTone ?? textTones?.[column.key]?.(raw);
                  const content = badge ? (
                    <span className={styles.badge} data-tone={badge.tone}>
                      {badge.label}
                    </span>
                  ) : pillTone ? (
                    <span className={styles.badge} data-tone={pillTone}>
                      <span className={styles.pillDot} aria-hidden="true" />
                      {text}
                    </span>
                  ) : textTone ? (
                    <span className={styles.amountText} data-tone={textTone}>
                      {text}
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
