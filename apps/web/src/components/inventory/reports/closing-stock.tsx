'use client';

import { useEffect, useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { inventoryReportsApi, type ReportOptions } from '@/lib/inventory/reports';
import { quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { SearchSelect } from '@/components/app/search-select';
import { FilterRow, ReportFrame, Summary, reportStyles as styles, useReport } from '../report-parts';

const SEARCH_DELAY_MS = 300;
const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.closingStock>[1]) =>
  inventoryReportsApi.closingStock(ctx, q);

/**
 * Closing Stock Valuation — what is on hand now, one branch or all, valued
 * at the last price paid for it (per stock unit). An item never bought is
 * valued at its list price, and marked so; one with neither is unvalued.
 */
export function ClosingStockReport({ ctx, options }: { ctx: InventoryContext; options: ReportOptions | null }) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [search]);
  const query = useMemo(() => ({ branch_id: branchId ?? undefined, q: q || undefined }), [branchId, q]);
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const money = (m: number) => formatMoney(m, data?.summary.currency ?? 'INR');

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
        <FilterRow label="Item">
          <input
            className={styles.search}
            type="search"
            placeholder="Search items"
            aria-label="Search items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
            { label: 'Items in stock', value: data.summary.items },
            { label: 'Stock value', value: money(data.summary.total_value_minor), tone: 'money' },
            ...(data.summary.unpriced ? [{ label: 'Without a price', value: data.summary.unpriced }] : []),
          ]}
        />
      ) : null}

      <p className={styles.tableLabel}>Stock on hand</p>
      <p className={styles.note}>Valued at the last purchase price; “list” marks an item never bought, at its list price.</p>
      <div className={styles.tableWrap}>
        {data?.rows.length ? (
          <table className={styles.table} aria-label="Stock on hand">
            <thead>
              <tr>
                <th>Item</th>
                <th className={styles.num}>Qty</th>
                <th className={styles.num}>Price / unit</th>
                <th className={styles.num}>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.item_id}>
                  <td>{r.name}</td>
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
