'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import {
  inventoryReportsApi,
  monthOf,
  rangeLabelYear,
  shortDay,
  type Consolidated,
  type ConsolidatedGroup,
} from '@/lib/inventory/reports';
import { quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { saveFile } from '@/lib/reports/api';
import { AppIcon } from '@/components/app/icons';
import { DateDialog } from '@/components/reports/date-range-dialog';
import { ReportFrame, reportStyles as styles, useReport } from '../report-parts';

const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.consolidated>[1]) =>
  inventoryReportsApi.consolidated(ctx, q);

const GROUPS: ReadonlyArray<{ key: ConsolidatedGroup; label: string; column: string }> = [
  { key: 'items', label: 'Items', column: 'Item' },
  { key: 'suppliers', label: 'Suppliers', column: 'Supplier' },
  { key: 'branches', label: 'Branches', column: 'Branch' },
];

type Row = Consolidated['rows'][number];

/** The columns after the name, per tab, as the reference draws them. */
function columns(group: ConsolidatedGroup, money: (m: number) => string): Array<{ label: string; cell: (r: Row) => string }> {
  const qty = (r: Row) => `${quantity(r.quantity)}${r.unit ? ` ${r.unit}` : ''}`;
  switch (group) {
    case 'items':
      return [
        { label: 'Total Qty', cell: qty },
        { label: 'Last Price', cell: (r) => (r.last_price_minor === null ? '—' : money(r.last_price_minor)) },
        { label: 'Total Spend', cell: (r) => money(r.spend_minor) },
      ];
    case 'suppliers':
      return [
        { label: 'Items', cell: (r) => String(r.items) },
        { label: 'Spend', cell: (r) => money(r.spend_minor) },
        { label: 'Last buy', cell: (r) => (r.last_buy ? shortDay(r.last_buy) : '—') },
      ];
    case 'branches':
      return [
        { label: 'Items', cell: (r) => String(r.items) },
        { label: 'Spend', cell: (r) => money(r.spend_minor) },
        { label: 'Outstanding', cell: (r) => money(r.outstanding_minor ?? 0) },
      ];
  }
}

/** A CSV cell: quoted when it holds a comma, quote or line break. */
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Consolidated — a period's purchases across every branch, by item (total
 * quantity, last price, spend), supplier (items, spend, last buy) or branch
 * (items, spend, outstanding), biggest spend first. The download saves the
 * tab on screen as CSV.
 */
export function ConsolidatedReport({ ctx, today }: { ctx: InventoryContext; today: string }) {
  const [group, setGroup] = useState<ConsolidatedGroup>('items');
  const [range, setRange] = useState(() => monthOf(today));
  const [picking, setPicking] = useState(false);
  const query = useMemo(() => ({ group, from: range.from, to: range.to }), [group, range]);
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const current = data?.group === group ? data : null;
  // Money in the CSV is plain rupees, so a spreadsheet can total it.
  const money = (m: number) => formatMoney(m, data?.summary.currency ?? 'INR');
  const cols = columns(group, money);
  const name = GROUPS.find((g) => g.key === group)!;

  const download = () => {
    if (!current) return;
    const plain = columns(group, (m) => (m / 100).toFixed(2));
    const lines = [
      [name.column, ...plain.map((c) => c.label)],
      ...current.rows.map((r) => [r.name, ...plain.map((c) => c.cell(r))]),
    ].map((row) => row.map(csvCell).join(','));
    saveFile({
      blob: new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }),
      filename: `consolidated-${group}-${range.from}-to-${range.to}.csv`,
    });
  };

  return (
    <ReportFrame
      title="Consolidated"
      tools={
        <button type="button" className={styles.download} aria-label="Download" disabled={!current?.rows.length} onClick={download}>
          <AppIcon name="download" size={26} />
        </button>
      }
      top={
        <>
          <div className={styles.underTabs} role="tablist" aria-label="Total by">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" role="tab" aria-selected={group === g.key} onClick={() => setGroup(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
          <div className={styles.dateBar}>
            <AppIcon name="calendar" size={22} />
            <span>{rangeLabelYear(range.from, range.to)}</span>
            <button type="button" className={styles.change} onClick={() => setPicking(true)}>
              Change
            </button>
          </div>
        </>
      }
    >
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.tableWrap}>
        {current?.rows.length ? (
          <table className={styles.table} aria-label={`By ${name.column.toLowerCase()}`}>
            <thead>
              <tr>
                <th>{name.column}</th>
                {cols.map((c) => (
                  <th key={c.label} className={styles.num}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  {cols.map((c, i) => (
                    <td key={c.label} className={`${styles.num} ${i === cols.length - 1 ? styles.strong : ''}`}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>{loading ? 'Loading…' : 'Nothing was received in this period.'}</p>
        )}
      </div>

      {picking ? (
        <DateDialog
          mode="range"
          initial={range}
          max={monthOf(today).to}
          onCancel={() => setPicking(false)}
          onApply={(picked) => {
            setRange(picked);
            setPicking(false);
          }}
        />
      ) : null}
    </ReportFrame>
  );
}
