'use client';

import { useMemo, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import {
  inventoryReportsApi,
  lastDays,
  rangeDash,
  type ReportOptions,
  type TransfersReport as Report,
} from '@/lib/inventory/reports';
import { dayTime, quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { saveFile } from '@/lib/reports/api';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import { DateDialog } from '@/components/reports/date-range-dialog';
import { ReportFrame, reportStyles as styles, useReport } from '../report-parts';

const PAGE = 100;
/** The export asks for this many lines at a time. */
const EXPORT_PAGE = 500;
const fetchReport = (ctx: InventoryContext, q: Parameters<typeof inventoryReportsApi.transfers>[1]) =>
  inventoryReportsApi.transfers(ctx, q);

type Row = Report['rows'][number];

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Stock Transfers — every outlet-to-outlet movement in a period (the last
 * seven days, to start), one branch sending or receiving or all: how many
 * transfers, what the raw materials moved were worth, and a card for each
 * item moved. Export saves the whole period as CSV.
 */
export function TransfersReport({ ctx, options, today }: { ctx: InventoryContext; options: ReportOptions | null; today: string }) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [range, setRange] = useState(() => lastDays(today, 7));
  const [picking, setPicking] = useState(false);
  const query = useMemo(
    () => ({ branch_id: branchId ?? undefined, from: range.from, to: range.to, limit: PAGE }),
    [branchId, range],
  );
  const { data, error, loading } = useReport(ctx, query, fetchReport);
  const [extra, setExtra] = useState<{ key: string; rows: Row[] }>({ key: '', rows: [] });
  const [busy, setBusy] = useState<'more' | 'export' | null>(null);
  const key = JSON.stringify(query);
  const rows = data ? [...data.rows, ...(extra.key === key ? extra.rows : [])] : [];
  const money = (m: number) => formatMoney(m, data?.summary.currency ?? 'INR');

  const showMore = async () => {
    setBusy('more');
    try {
      const next = await inventoryReportsApi.transfers(ctx, { ...query, offset: rows.length });
      setExtra((prev) => ({ key, rows: [...(prev.key === key ? prev.rows : []), ...next.rows] }));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    if (!data) return;
    setBusy('export');
    try {
      const all: Row[] = [];
      for (let offset = 0; offset < data.meta.total; offset += EXPORT_PAGE) {
        all.push(...(await inventoryReportsApi.transfers(ctx, { ...query, limit: EXPORT_PAGE, offset })).rows);
      }
      const lines = [
        ['Date', 'Time', 'Transfer', 'From', 'To', 'Item', 'Type', 'Qty', 'Unit', 'Value'],
        ...all.map((r) => [
          r.date,
          new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          r.number,
          r.from,
          r.to,
          r.item,
          r.kind === 'PRODUCT' ? 'Product' : 'Raw material',
          String(r.quantity),
          r.unit ?? '',
          r.value_minor === null ? '' : (r.value_minor / 100).toFixed(2),
        ]),
      ].map((row) => row.map(csvCell).join(','));
      saveFile({
        blob: new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }),
        filename: `stock-transfers-${range.from}-to-${range.to}.csv`,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ReportFrame
      title="Stock Transfers"
      top={
        <div className={styles.bandInner}>
          <div className={styles.headPick}>
            <SearchSelect
              label="Branch"
              allLabel="All Branches"
              options={(options?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
              value={branchId}
              onChange={setBranchId}
              align="end"
            />
          </div>
          <div className={styles.dateExport}>
            <button type="button" className={styles.datePill} aria-label={`Dates: ${rangeDash(range.from, range.to)}`} onClick={() => setPicking(true)}>
              <AppIcon name="calendar" size={24} />
              {rangeDash(range.from, range.to)}
            </button>
            <button type="button" className={styles.export} disabled={!data?.rows.length || busy === 'export'} onClick={() => void exportCsv()}>
              <AppIcon name="download" size={22} />
              {busy === 'export' ? 'Exporting…' : 'Export'}
            </button>
          </div>
          {data ? (
            <div className={styles.stats}>
              <section className={styles.stat} aria-label="Transfers">
                <span className={styles.statTop}>
                  Transfers
                  <span className={styles.statIcon} data-tone="red">
                    <AppIcon name="transfer" size={22} />
                  </span>
                </span>
                <p className={styles.statValue}>{data.summary.transfers}</p>
              </section>
              <section className={styles.stat} aria-label="Value moved">
                <span className={styles.statTop}>
                  Value moved
                  <span className={styles.statIcon} data-tone="green">
                    <AppIcon name="rupee" size={22} />
                  </span>
                </span>
                <p className={styles.statValue}>{money(data.summary.value_minor)}</p>
              </section>
            </div>
          ) : null}
        </div>
      }
    >
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {rows.length ? (
        <ul className={styles.moves} aria-label="Movements">
          {rows.map((r) => (
            <li key={r.id} className={styles.move}>
              <span className={styles.moveIcon}>
                <AppIcon name="transfer" size={24} />
              </span>
              <span className={styles.moveText}>
                <span className={styles.moveTitle}>
                  {r.item} — {quantity(r.quantity)}
                  {r.unit ? ` ${r.unit}` : ''}
                  {r.kind === 'PRODUCT' ? <span className={styles.tag}>Product</span> : null}
                </span>
                <span className={styles.moveSub}>
                  {r.from} → {r.to} · {dayTime(r.created_at)}
                </span>
              </span>
              <span className={styles.moveValue}>{r.value_minor === null ? '—' : money(r.value_minor)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{loading ? 'Loading…' : 'No transfers in these dates.'}</p>
      )}
      {data && rows.length < data.meta.total ? (
        <button type="button" className={styles.more} disabled={busy === 'more'} onClick={() => void showMore()}>
          {busy === 'more' ? 'Loading…' : 'Show more'}
        </button>
      ) : null}

      {picking ? (
        <DateDialog
          mode="range"
          initial={range}
          max={today}
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
