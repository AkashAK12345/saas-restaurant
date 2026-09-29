'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { InventoryContext } from '@/lib/inventory/api';
import { rangeLabel } from '@/lib/inventory/reports';
import { AppIcon } from '@/components/app/icons';
import { DateDialog } from '@/components/reports/date-range-dialog';
import styles from './inventory-reports.module.css';

/** The report screen's frame: back to the list, "Inventory › Reports", the title. */
export function ReportFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/inventory/reports" className={styles.back} aria-label="Back to reports">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory › Reports</p>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** "Item [All items ▾]": a labelled row of the filters card. */
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className={styles.filterLabel}>{label}</span>
      {children}
    </>
  );
}

/** "📅 1 Sep → 30 Sep", opening the range picker. */
export function DatesButton({
  label,
  range,
  max,
  onChange,
  tone,
}: {
  label: string;
  range: { from: string; to: string };
  max: string;
  onChange: (range: { from: string; to: string }) => void;
  /** The calendar's colour, to tell two periods apart. */
  tone?: 'blue';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.dates}
        data-tone={tone}
        aria-label={`${label}: ${rangeLabel(range.from, range.to)}`}
        onClick={() => setOpen(true)}
      >
        <AppIcon name="calendar" size={22} />
        {rangeLabel(range.from, range.to)}
      </button>
      {open ? (
        <DateDialog
          mode="range"
          initial={range}
          max={max}
          onCancel={() => setOpen(false)}
          onApply={(picked) => {
            onChange(picked);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export interface SummaryRow {
  label: string;
  value: ReactNode;
  /** money: the brand red; up / down: green / red; a / b: a period's colour. */
  tone?: 'money' | 'up' | 'down' | 'a' | 'b';
  /** Start a new group, under a rule. */
  rule?: boolean;
}

/** SUMMARY: label on the left, figure on the right. */
export function Summary({ rows, title = 'Summary', showTitle = true }: { rows: SummaryRow[]; title?: string; showTitle?: boolean }) {
  return (
    <section className={styles.summary} aria-label={title}>
      {showTitle ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
      <dl>
        {rows.map((r) => (
          <div key={r.label} className={r.rule ? styles.rule : undefined}>
            <dt>{r.label}</dt>
            <dd data-tone={r.tone} className={r.tone === 'up' ? styles.up : r.tone === 'down' ? styles.down : undefined}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Load a report for `query`, again whenever it changes. `fetch` must be
 * stable (a module-level function). The last result stays on screen while
 * the next is read.
 */
export function useReport<Q, T>(
  ctx: InventoryContext | null,
  query: Q,
  fetch: (ctx: InventoryContext, query: Q) => Promise<T>,
) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    const k = JSON.stringify(query);
    fetch(ctx, query)
      .then((data) => !cancelled && setState({ key: k, data, error: null }))
      .catch((e) => !cancelled && setState({ key: k, data: null, error: e instanceof Error ? e.message : 'Could not load the report' }));
    return () => {
      cancelled = true;
    };
  }, [ctx, query, fetch]);
  return { data: state?.data ?? null, error: state?.error ?? null, loading: !state || state.key !== key };
}

export { styles as reportStyles };
