'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { inventoryReportsApi, type ReportOptions } from '@/lib/inventory/reports';
import { quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { SearchSelect } from '@/components/app/search-select';
import { FilterRow, ReportFrame, reportStyles as styles, useReport } from '../report-parts';

const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.closingStock>[1]) =>
  inventoryReportsApi.closingStock(ctx, q);

/**
 * Closing Stock Valuation — what is on hand now, each item at each branch,
 * valued at the last price paid for it (per stock unit), biggest value
 * first, under the total. An item never bought is valued at its list
 * price, and marked so; one with neither is left unvalued.
 */
export function ClosingStockReport({ ctx, options }: { ctx: InventoryContext; options: ReportOptions | null }) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const query = useMemo(() => ({ branch_id: branchId ?? undefined }), [branchId]);
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const money = (m: number) => formatMoney(m, data?.summary.currency ?? 'INR');
  const listed = data?.rows.filter((r) => r.price_source === 'item_price').length ?? 0;

  return (
    <ReportFrame title="Closing Stock Valuation">
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
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <section className={styles.totalCard} aria-label="Total stock value">
          <h2 className={styles.sectionTitle}>Total stock value</h2>
          <p className={styles.totalValue}>{money(data.summary.total_value_minor)}</p>
          <p className={styles.totalMethod}>
            Method: last purchase price · {data.summary.items} items
            {listed ? ` · ${listed} at list price` : ''}
            {data.summary.unpriced ? ` · ${data.summary.unpriced} without a price` : ''}
          </p>
        </section>
      ) : null}

      <div className={styles.tableWrap}>
        {data?.rows.length ? (
          <table className={`${styles.table} ${styles.wide}`} aria-label="Stock on hand">
            <thead>
              <tr>
                <th>Item</th>
                <th>Branch</th>
                <th className={styles.num}>Qty</th>
                <th className={styles.num}>Last Price</th>
                <th className={styles.num}>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.item_id}:${r.branch_id}`}>
                  <td>{r.name}</td>
                  <td>{r.branch}</td>
                  <td className={styles.num}>
                    {quantity(r.quantity)} {r.unit}
                  </td>
                  <td className={styles.num}>
                    {r.price_minor === null ? '—' : money(r.price_minor)}
                    {r.price_source === 'item_price' ? <span className={styles.tag}>list</span> : null}
                  </td>
                  <td className={`${styles.num} ${styles.strong}`}>{r.price_minor === null ? '—' : money(r.value_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>{loading ? 'Loading…' : 'No stock on hand.'}</p>
        )}
      </div>
    </ReportFrame>
  );
}
