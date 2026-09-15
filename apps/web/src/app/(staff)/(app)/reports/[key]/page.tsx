'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { reportsApi, saveFile, type ReportQuery } from '@/lib/reports/api';
import { MetricGrid } from '@/components/reports/metric-grid';
import { ReportTable } from '@/components/reports/report-table';
import { formatDateLabel } from '@/lib/reports/format';
import type { ExportFormat, ReportResponse } from '@/lib/reports/types';
import styles from '@/components/reports/reports.module.css';

const PAGE_SIZE = 50;

/**
 * One report.
 *
 * GENERIC BY CONSTRUCTION: this page knows no report by name. Columns,
 * filters, metrics and pagination all come from the definition the server
 * returned, so a report registered by a future backend module renders here
 * without a line of frontend work.
 *
 * Every filter change is a SERVER query. The browser never holds more than the
 * page on screen, and an export goes through the same endpoint family, so it
 * can never contain a row the viewer could not already read.
 */
export default function ReportPage() {
  const params = useParams<{ key: string }>();
  const reportKey = Array.isArray(params.key) ? params.key[0] : params.key;

  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayExport = hasPermission(branchPermissions, 'reports.export');

  // Dates are BRANCH-LOCAL calendar days, and the branch's timezone is not
  // known until the server answers. So the first run sends no dates at all and
  // lets the API pick its default window in the branch's own zone, and the
  // pickers DISPLAY what it used. Guessing here with the viewer's clock would
  // show "today" a day out for half the world.
  //
  // These hold only what the USER chose; empty means "server default". They are
  // deliberately never written back from the response: doing that changed the
  // query and fired a second, identical request, which left the page loading —
  // and its buttons disabled — after the table had already appeared.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  // Bumped by "Run" so pressing it always asks the server again — even when
  // nothing in the form changed and the page is already on the first page.
  // Without it the button did nothing at all in that state.
  const [runs, setRuns] = useState(0);

  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const query = useMemo<ReportQuery>(
    () => ({ from, to, limit: PAGE_SIZE, offset, options }),
    [from, to, offset, options],
  );

  useEffect(() => {
    if (!ctx || !reportKey) return;
    void runs; // a dependency on purpose: see `runs` above
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await reportsApi.run(ctx, reportKey, query);
        if (cancelled) return;
        setReport(res);
      } catch (e) {
        if (!cancelled) {
          setReport(null);
          setLoadError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, reportKey, query, runs]);

  const runExport = useCallback(
    async (format: ExportFormat) => {
      if (!ctx || !reportKey) return;
      setExporting(format);
      setActionError(null);
      setNotice(null);
      try {
        // The export applies the SAME filters, minus pagination: a downloaded
        // file that silently held only page one would be worse than useless.
        const file = await reportsApi.export(ctx, reportKey, format, { from, to, options });
        saveFile(file);
        setNotice(`Downloaded ${file.filename}`);
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setExporting(null);
      }
    },
    [ctx, reportKey, from, to, options],
  );

  if (!ctx) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Report</h1>
        <p className={styles.notice}>Select a company and branch to run a report.</p>
      </section>
    );
  }

  const timezone = report?.timezone ?? 'UTC';
  const total = report?.meta.total ?? 0;
  const paginated = report?.kind === 'rows';
  const shown = report?.rows.length ?? 0;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{report?.name ?? reportKey}</h1>
          <p className={styles.subtitle}>{report?.description}</p>
          {report ? (
            <p className={styles.zone}>
              {report.branch_name ? `${report.branch_name} · ` : ''}
              {formatDateLabel(report.filters.from)} to {formatDateLabel(report.filters.to)} · {report.timezone}
            </p>
          ) : null}
        </div>
        <Link className={styles.button} href="/reports">
          All reports
        </Link>
      </header>

      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setRuns((n) => n + 1);
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="report-from">
            From
          </label>
          <input
            id="report-from"
            className={styles.input}
            type="date"
            value={from || report?.filters.from || ''}
            onChange={(event) => {
              setFrom(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="report-to">
            To
          </label>
          <input
            id="report-to"
            className={styles.input}
            type="date"
            value={to || report?.filters.to || ''}
            onChange={(event) => {
              setTo(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        {/* Filters are whatever the report declared — never a free-text box. */}
        {(report?.option_specs ?? []).map((spec) => (
          <div className={styles.field} key={spec.key}>
            <label className={styles.label} htmlFor={`report-${spec.key}`}>
              {spec.label}
            </label>
            <select
              id={`report-${spec.key}`}
              className={styles.select}
              value={options[spec.key] ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setOptions((current) => {
                  const next = { ...current };
                  if (value) next[spec.key] = value;
                  else delete next[spec.key];
                  return next;
                });
                setOffset(0);
              }}
            >
              <option value="">All</option>
              {spec.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className={styles.actions}>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={loading}>
            {loading ? 'Running…' : 'Run'}
          </button>
          {mayExport && report?.exportable !== false ? (
            <>
              <button
                type="button"
                className={styles.button}
                disabled={exporting !== null || loading}
                onClick={() => void runExport('xlsx')}
              >
                {exporting === 'xlsx' ? 'Preparing…' : 'Export Excel'}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={exporting !== null || loading}
                onClick={() => void runExport('pdf')}
              >
                {exporting === 'pdf' ? 'Preparing…' : 'Export PDF'}
              </button>
            </>
          ) : null}
        </div>
      </form>

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {report ? (
        <>
          <MetricGrid metrics={report.metrics} timezone={timezone} />
          <ReportTable
            columns={report.columns}
            rows={report.rows}
            timezone={timezone}
            caption={`${report.name}, ${formatDateLabel(report.filters.from)} to ${formatDateLabel(report.filters.to)}`}
            drilldown={report.drilldown}
          />

          {paginated ? (
            <div className={styles.pagination}>
              <span className={styles.pageInfo}>
                {total === 0
                  ? 'No rows'
                  : `Showing ${offset + 1}–${offset + shown} of ${total}`}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={offset + shown >= total || loading}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
