'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { inventoryReportsApi, monthOf, type ConsolidatedGroup } from '@/lib/inventory/reports';
import { quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { DatesButton, FilterRow, ReportFrame, Summary, reportStyles as styles, useReport } from '../report-parts';

const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.consolidated>[1]) =>
  inventoryReportsApi.consolidated(ctx, q);

const GROUPS: ReadonlyArray<{ key: ConsolidatedGroup; label: string; column: string }> = [
  { key: 'items', label: 'Items', column: 'Item' },
  { key: 'suppliers', label: 'Suppliers', column: 'Supplier' },
  { key: 'branches', label: 'Branches', column: 'Branch' },
];

/**
 * Head Outlet Consolidated — a period's purchases across every branch,
 * totalled by item, supplier or branch, biggest spend first.
 */
export function ConsolidatedReport({ ctx, today }: { ctx: InventoryContext; today: string }) {
  const [group, setGroup] = useState<ConsolidatedGroup>('items');
  const [range, setRange] = useState(() => monthOf(today));
  const query = useMemo(() => ({ group, from: range.from, to: range.to }), [group, range]);
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const money = (m: number) => formatMoney(m, data?.summary.currency ?? 'INR');
  const column = GROUPS.find((g) => g.key === group)!.column;

  return (
    <ReportFrame title="Head Outlet Consolidated">
      <div className={styles.filters}>
        <FilterRow label="Date">
          <DatesButton label="Date" range={range} max={monthOf(today).to} onChange={setRange} />
        </FilterRow>
        <FilterRow label="By">
          <div className={styles.segment} role="tablist" aria-label="Total by">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" role="tab" aria-selected={group === g.key} onClick={() => setGroup(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </FilterRow>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <Summary
          rows={[
            { label: 'Branches', value: data.branches },
            { label: GROUPS.find((g) => g.key === data.group)!.label, value: data.summary.rows },
            { label: 'Orders', value: data.summary.orders },
            { label: 'Total spend', value: money(data.summary.spend_minor), tone: 'money' },
          ]}
        />
      ) : null}

      <p className={styles.tableLabel}>{GROUPS.find((g) => g.key === group)!.label}</p>
      <div className={styles.tableWrap}>
        {data?.rows.length && data.group === group ? (
          <table className={styles.table} aria-label={`By ${column.toLowerCase()}`}>
            <thead>
              <tr>
                <th>{column}</th>
                {group === 'items' ? <th className={styles.num}>Qty</th> : null}
                <th className={styles.num}>Orders</th>
                <th className={styles.num}>Spend</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  {group === 'items' ? (
                    <td className={styles.num}>
                      {quantity(r.quantity)}
                      {r.unit ? ` ${r.unit}` : ''}
                    </td>
                  ) : null}
                  <td className={styles.num}>{r.orders}</td>
                  <td className={`${styles.num} ${styles.strong}`}>{money(r.spend_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>{loading ? 'Loading…' : 'Nothing was received in this period.'}</p>
        )}
      </div>
    </ReportFrame>
  );
}
