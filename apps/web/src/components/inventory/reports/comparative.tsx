'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { inventoryReportsApi, monthOf, type ReportOptions } from '@/lib/inventory/reports';
import { formatMoney } from '@/lib/reports/format';
import { SearchSelect } from '@/components/app/search-select';
import { DatesButton, FilterRow, ReportFrame, Summary, reportStyles as styles, useReport } from '../report-parts';

const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.comparative>[1]) =>
  inventoryReportsApi.comparative(ctx, q);

/** "+924.3%" for the whole; a supplier's whole percent ("+1535%"); "—" with nothing in B. */
function pct(p: number | null, whole: boolean): string {
  if (p === null) return '—';
  const shown = whole ? Math.round(p) : p;
  return `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${Math.abs(shown)}%`;
}

const tone = (p: number | null) => (p === null || p === 0 ? undefined : p > 0 ? ('up' as const) : ('down' as const));

/**
 * Comparative Purchase — Period A (this month, to start) measured against
 * Period B (last month): each side's spend, the change as a percentage of
 * B, the orders on each side, and every supplier's two figures, biggest
 * Period A spend first.
 */
export function ComparativeReport({ ctx, options, today }: { ctx: InventoryContext; options: ReportOptions | null; today: string }) {
  const [a, setA] = useState(() => monthOf(today));
  const [b, setB] = useState(() => monthOf(today, 1));
  const [branchId, setBranchId] = useState<string | null>(null);
  const query = useMemo(
    () => ({ branch_id: branchId ?? undefined, a_from: a.from, a_to: a.to, b_from: b.from, b_to: b.to }),
    [branchId, a, b],
  );
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const money = (m: number) => formatMoney(m, data?.currency ?? 'INR');
  const max = monthOf(today).to;

  return (
    <ReportFrame title="Comparative Purchase">
      <div className={styles.filters}>
        <FilterRow label="Period A">
          <DatesButton label="Period A" range={a} max={max} onChange={setA} />
        </FilterRow>
        <FilterRow label="Period B">
          <DatesButton label="Period B" range={b} max={max} onChange={setB} tone="blue" />
        </FilterRow>
        <FilterRow label="Branch">
          <SearchSelect
            label="Branch"
            allLabel="All branches"
            options={(options?.branches ?? []).map((x) => ({ value: x.id, label: x.name }))}
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
        <Summary
          showTitle={false}
          rows={[
            { label: 'Period A spend', value: money(data.a.spend_minor), tone: 'a' },
            { label: 'Period B spend', value: money(data.b.spend_minor), tone: 'b' },
            { label: 'Δ', value: pct(data.delta_pct, false), tone: tone(data.delta_pct), rule: true },
            { label: 'Orders', value: `${data.a.orders} vs ${data.b.orders}` },
          ]}
        />
      ) : null}

      <p className={styles.tableLabel}>Per supplier</p>
      {data?.suppliers.length ? (
        <ul className={styles.supplierCards} aria-label="Per supplier">
          {data.suppliers.map((s) => (
            <li key={s.vendor_id} className={styles.supplierCard}>
              <span className={styles.supplierText}>
                <span className={styles.supplierName}>{s.name}</span>
                <span className={styles.supplierFigures}>
                  <span>A {money(s.a_spend_minor)}</span>
                  <span>B {money(s.b_spend_minor)}</span>
                </span>
              </span>
              <span className={styles.supplierDelta} data-tone={tone(s.delta_pct)}>
                {pct(s.delta_pct, true)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{loading ? 'Loading…' : 'Nothing was received in either period.'}</p>
      )}
    </ReportFrame>
  );
}
