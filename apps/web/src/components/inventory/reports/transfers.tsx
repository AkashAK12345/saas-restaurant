'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { inventoryReportsApi, monthOf, shortDay, type ReportOptions, type TransfersReport as Report } from '@/lib/inventory/reports';
import { quantity } from '@/lib/inventory/format';
import { SearchSelect } from '@/components/app/search-select';
import { DatesButton, FilterRow, ReportFrame, Summary, reportStyles as styles, useReport } from '../report-parts';

const PAGE = 100;
const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.transfers>[1]) =>
  inventoryReportsApi.transfers(ctx, q);

/**
 * Stock Transfers — every outlet-to-outlet movement in a period, from the
 * stock ledger: one branch (sending or receiving) or all, newest first.
 */
export function TransfersReport({ ctx, options, today }: { ctx: InventoryContext; options: ReportOptions | null; today: string }) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [range, setRange] = useState(() => monthOf(today));
  const query = useMemo(
    () => ({ branch_id: branchId ?? undefined, from: range.from, to: range.to, limit: PAGE }),
    [branchId, range],
  );
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const [extra, setExtra] = useState<{ key: string; rows: Report['rows'] }>({ key: '', rows: [] });
  const [moreBusy, setMoreBusy] = useState(false);
  const key = JSON.stringify(query);
  const rows = data ? [...data.rows, ...(extra.key === key ? extra.rows : [])] : [];

  const showMore = async () => {
    setMoreBusy(true);
    try {
      const next = await inventoryReportsApi.transfers(ctx, { ...query, offset: rows.length });
      setExtra((prev) => ({ key, rows: [...(prev.key === key ? prev.rows : []), ...next.rows] }));
    } finally {
      setMoreBusy(false);
    }
  };

  return (
    <ReportFrame title="Stock Transfers">
      <div className={styles.filters}>
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

      {data ? (
        <Summary
          rows={[
            { label: 'Transfers', value: data.summary.transfers },
            { label: 'Items moved', value: data.summary.lines },
          ]}
        />
      ) : null}

      <p className={styles.tableLabel}>Movements</p>
      <div className={styles.tableWrap}>
        {rows.length ? (
          <table className={`${styles.table} ${styles.wide}`} aria-label="Movements">
            <thead>
              <tr>
                <th>Date</th>
                <th>Transfer</th>
                <th>From</th>
                <th>To</th>
                <th>Item</th>
                <th className={styles.num}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{shortDay(r.date)}</td>
                  <td>{r.number}</td>
                  <td>{r.from}</td>
                  <td>{r.to}</td>
                  <td>
                    {r.item}
                    {r.kind === 'PRODUCT' ? <span className={styles.tag}>Product</span> : null}
                  </td>
                  <td className={`${styles.num} ${styles.strong}`}>
                    {quantity(r.quantity)}
                    {r.unit ? ` ${r.unit}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>{loading ? 'Loading…' : 'No transfers in this period.'}</p>
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
