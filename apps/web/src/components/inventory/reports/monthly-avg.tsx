'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { inventoryReportsApi, monthOf, shortDay, type MonthlyAvg, type ReportOptions } from '@/lib/inventory/reports';
import { quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { SearchSelect } from '@/components/app/search-select';
import { DatesButton, FilterRow, ReportFrame, Summary, reportStyles as styles, useReport } from '../report-parts';

const PAGE = 100;
const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.monthlyAvg>[1]) =>
  inventoryReportsApi.monthlyAvg(ctx, q);

/**
 * Monthly Avg Purchase — what arrived in a period, one item or all, one
 * branch or all: the orders, average quantity and price, totals, and the
 * order history line by line.
 */
export function MonthlyAvgReport({ ctx, options, today }: { ctx: InventoryContext; options: ReportOptions | null; today: string }) {
  const [itemId, setItemId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [range, setRange] = useState(() => monthOf(today));
  const query = useMemo(
    () => ({ item_id: itemId ?? undefined, branch_id: branchId ?? undefined, from: range.from, to: range.to, limit: PAGE }),
    [itemId, branchId, range],
  );
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const [extra, setExtra] = useState<{ key: string; rows: MonthlyAvg['rows'] }>({ key: '', rows: [] });
  const [moreBusy, setMoreBusy] = useState(false);
  const key = JSON.stringify(query);
  const rows = data ? [...data.rows, ...(extra.key === key ? extra.rows : [])] : [];

  const showMore = async () => {
    setMoreBusy(true);
    try {
      const next = await inventoryReportsApi.monthlyAvg(ctx, { ...query, offset: rows.length });
      setExtra((prev) => ({ key, rows: [...(prev.key === key ? prev.rows : []), ...next.rows] }));
    } finally {
      setMoreBusy(false);
    }
  };

  const s = data?.summary;
  const money = (m: number) => formatMoney(m, s?.currency ?? 'INR');
  return (
    <ReportFrame title="Monthly Avg Purchase">
      <div className={styles.filters}>
        <FilterRow label="Item">
          <SearchSelect
            label="Item"
            allLabel="All items"
            options={(options?.items ?? []).map((i) => ({ value: i.id, label: i.name, hint: i.unit }))}
            value={itemId}
            onChange={setItemId}
            align="end"
          />
        </FilterRow>
        <FilterRow label="Branch">
          <SearchSelect
            label="Branch"
            allLabel="All branches"
            options={(options?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
            value={branchId}
            onChange={setBranchId}
            align="end"
          />
        </FilterRow>
        <FilterRow label="Date">
          <DatesButton label="Date" range={range} max={monthOf(today).to} onChange={setRange} />
        </FilterRow>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {s ? (
        <Summary
          rows={[
            { label: 'Orders', value: s.orders },
            { label: 'Avg qty / order', value: quantity(s.avg_qty) },
            { label: 'Avg price', value: money(s.avg_price_minor), tone: 'money' },
            { label: 'Total qty', value: quantity(s.total_qty) },
            { label: 'Total spend', value: money(s.total_spend_minor), tone: 'money' },
          ]}
        />
      ) : null}

      <p className={styles.tableLabel}>Order history</p>
      <div className={styles.tableWrap}>
        {rows.length ? (
          <table className={`${styles.table} ${styles.wide}`} aria-label="Order history">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Branch</th>
                <th>Item</th>
                <th className={styles.num}>Qty</th>
                <th className={styles.num}>Price</th>
                <th className={styles.num}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{shortDay(r.date)}</td>
                  <td>{r.supplier}</td>
                  <td>{r.branch}</td>
                  <td>{r.item}</td>
                  <td className={styles.num}>
                    {quantity(r.quantity)}
                    {r.unit ? ` ${r.unit}` : ''}
                  </td>
                  <td className={styles.num}>{money(r.price_minor)}</td>
                  <td className={`${styles.num} ${styles.strong}`}>{money(r.total_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>{loading ? 'Loading…' : 'Nothing was received in this period.'}</p>
        )}
      </div>
      {data && rows.length < data.meta.total ? (
        <button type="button" className={styles.more} disabled={moreBusy} onClick={() => void showMore()}>
          {moreBusy ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </ReportFrame>
  );
}
