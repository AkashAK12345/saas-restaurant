'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission, PERMISSION_KEYS } from '@/lib/auth/permissions';
import { reportsApi, saveFile } from '@/lib/reports/api';
import { branchToday, shiftDate } from '@/lib/reports/format';
import type { ReportResponse } from '@/lib/reports/types';
import { MetricGrid } from '@/components/reports/metric-grid';
import { ReportTable } from '@/components/reports/report-table';
import { DateDialog } from '@/components/reports/date-range-dialog';
import { AppIcon } from '@/components/app/icons';
import {
  PURCHASE_CARDS,
  PURCHASE_ICONS,
  PURCHASE_VIEWS,
  matchesSearch,
  pillRangeLabel,
  type PurchaseView,
} from '@/lib/reports/purchase-ui';
import reportStyles from '@/components/reports/reports.module.css';
import styles from '@/components/reports/purchase.module.css';

/**
 * Purchase Reports — what a branch ordered from its vendors over a period,
 * seen by vendor or by item, under one set of cards. Read from the
 * `purchase.*` reports, so the server's permission check and the branch's
 * own clock apply as for any report.
 */
export default function PurchaseReportsPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId ? { companyId: selectedCompanyId, branchId: selectedBranchId } : null,
    [selectedCompanyId, selectedBranchId],
  );
  const timezone = selectedBranch?.timezone ?? 'UTC';
  const today = branchToday(timezone);

  // The last week, both ends included, as the reference opens.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const shown = range ?? { from: shiftDate(today, -7), to: today };
  const [view, setView] = useState<PurchaseView>('by_vendor');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const mayExport = hasPermission(branchPermissions ?? [], PERMISSION_KEYS.REPORTS_EXPORT);
  const reportKey = PURCHASE_VIEWS.find((v) => v.key === view)!.report;

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const res = await reportsApi.run(ctx, reportKey, { from: shown.from, to: shown.to });
        if (!cancelled) setReport(res);
      } catch (e) {
        if (!cancelled) {
          setReport(null);
          setError(e instanceof Error ? e.message : 'Could not load purchase reports');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, reportKey, shown.from, shown.to]);

  if (!ctx) {
    return (
      <section className={reportStyles.page}>
        <p className={reportStyles.empty} role="status">
          Choose a branch to see its purchase reports.
        </p>
      </section>
    );
  }

  const rows = (report?.rows ?? []).filter((row) => matchesSearch(row, search));
  const cards = (report?.metrics ?? []).filter((m) => (PURCHASE_CARDS as readonly string[]).includes(m.key));

  const exportView = async () => {
    setExporting(true);
    setError(null);
    try {
      saveFile(await reportsApi.export(ctx, reportKey, 'xlsx', { from: shown.from, to: shown.to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/" className={styles.back} aria-label="Back">
          <AppIcon name="back" size={22} />
        </Link>
        <h1 className={styles.title}>Purchase Reports</h1>
      </header>

      <div className={styles.toolbar}>
        <button type="button" className={styles.datePill} onClick={() => setDialog(true)} aria-label="Change dates">
          <AppIcon name="calendar" size={20} />
          <span className={styles.pillText}>{pillRangeLabel(shown.from, shown.to)}</span>
        </button>
        <label className={styles.search}>
          <AppIcon name="search" size={18} />
          <span className="sr-only">Search vendors or items</span>
          <input
            type="search"
            placeholder="Search vendors or items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {mayExport ? (
          <button type="button" className={styles.export} onClick={() => void exportView()} disabled={exporting}>
            <AppIcon name="share" size={18} />
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className={reportStyles.error} role="alert">
          {error}
        </p>
      ) : null}

      {report ? <MetricGrid metrics={cards} timezone={timezone} icons={PURCHASE_ICONS} /> : null}

      <div className={styles.toggle} role="group" aria-label="Group purchases">
        {PURCHASE_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={styles.toggleButton}
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {report ? (
        report.rows.length === 0 ? (
          <p className={styles.empty} role="status">
            No purchases found for this period
          </p>
        ) : rows.length === 0 ? (
          <p className={styles.empty} role="status">
            Nothing matches “{search.trim()}”
          </p>
        ) : (
          <ReportTable
            columns={report.columns}
            rows={rows}
            timezone={timezone}
            caption={`${report.name}, ${shown.from} to ${shown.to}`}
            boldColumns={['vendor', 'item']}
          />
        )
      ) : null}

      {dialog ? (
        <DateDialog
          mode="range"
          initial={shown}
          max={today}
          onCancel={() => setDialog(false)}
          onApply={(picked) => {
            setRange(picked);
            setDialog(false);
          }}
        />
      ) : null}
    </section>
  );
}
