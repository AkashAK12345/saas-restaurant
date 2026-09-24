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
  /** Lead with a dot in the tone's colour, as a status does ("● Received"). */
  dot?: boolean;
}

/** A cell drawn as an icon, e.g. a sent/not-sent tick or cross. */
export interface IconCellSpec {
  icon: 'checkCircle' | 'xCircle';
  tone: 'success' | 'danger';
  /** What the icon says, for assistive technology and on hover. */
  label: string;
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
  cellAddons,
  rowAction,
  clampColumns,
  textPills,
  boldColumns,
  iconCells,
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
  /** Column key -> a small pill after the cell's own value, read from the
   *  whole row — e.g. "+1 filed" beside a pending count. */
  cellAddons?: Readonly<Record<string, (row: Record<string, unknown>) => BadgeSpec | undefined>>;
  /** Columns whose long text is cut to one line with "…" (the full text is
   *  in the cell's title, and in the row's details). */
  clampColumns?: readonly string[];
  /** Column key -> an icon instead of the text, by the raw value. */
  iconCells?: Readonly<Record<string, (value: unknown) => IconCellSpec | undefined>>;
  /** Columns set in bold — the figure a row is read by, e.g. a total. */
  boldColumns?: readonly string[];
  /** Column key -> any value shown as a coloured pill, by its raw value —
   *  e.g. "Yes" in green and "No" in red, or a "5/6" score. */
  textPills?: Readonly<Record<string, (value: unknown) => BadgeSpec['tone'] | undefined>>;
  /** A trailing column with one button per row, e.g. "View" to open the
   *  submission in full. The page decides what opening means. */
  rowAction?: {
    header: string;
    label: string;
    /** Names the row for assistive technology: "View 23 Sep 2026". */
    describe: (row: Record<string, unknown>) => string;
    onSelect: (row: Record<string, unknown>) => void;
  };
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
            {rowAction ? <th scope="col">{rowAction.header}</th> : null}
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
                  const textPill = raw === null || raw === undefined ? undefined : textPills?.[column.key]?.(raw);
                  const iconCell = iconCells?.[column.key]?.(raw);
                  const content = iconCell ? (
                    <span className={styles.iconCell} data-tone={iconCell.tone} title={iconCell.label}>
                      <AppIcon name={iconCell.icon} size={24} />
                      <span className="sr-only">{iconCell.label}</span>
                    </span>
                  ) : badge ? (
                    <span className={styles.badge} data-tone={badge.tone}>
                      {badge.dot ? <span className={styles.pillDot} aria-hidden="true" /> : null}
                      {badge.label}
                    </span>
                  ) : pillTone ? (
                    <span className={styles.badge} data-tone={pillTone}>
                      <span className={styles.pillDot} aria-hidden="true" />
                      {text}
                    </span>
                  ) : textPill ? (
                    <span className={styles.badge} data-tone={textPill}>
                      {text}
                    </span>
                  ) : textTone ? (
                    <span className={styles.amountText} data-tone={textTone}>
                      {text}
                    </span>
                  ) : (
                    text
                  );
                  const addon = cellAddons?.[column.key]?.(row);
                  return (
                    <td
                      key={column.key}
                      className={
                        [
                          isNumericType(column.type) ? styles.numeric : '',
                          boldColumns?.includes(column.key) ? styles.boldCell : '',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      {href && columnIndex === 0 ? (
                        <Link href={href}>{content}</Link>
                      ) : clampColumns?.includes(column.key) ? (
                        <span className={styles.clamp} title={text}>
                          {content}
                        </span>
                      ) : (
                        content
                      )}
                      {addon ? (
                        <span className={`${styles.badge} ${styles.cellAddon}`} data-tone={addon.tone}>
                          <span className={styles.pillDot} aria-hidden="true" />
                          {addon.label}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                {rowAction ? (
                  <td>
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={`${rowAction.label} ${rowAction.describe(row)}`}
                      onClick={() => rowAction.onSelect(row)}
                    >
                      {rowAction.label}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
