'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi } from '@/lib/tasks/api';
import { addCalendarDays, branchToday, deviceTimeZone, formatCalendarDate } from '@/lib/format/datetime';
import type { RoutineLog } from '@/lib/tasks/types';
import { saveFile } from '@/lib/reports/api';
import styles from '@/components/tasks/tasks.module.css';

/** The API refuses a longer PDF; beyond this many columns it is unreadable. */
const PDF_MAX_DAYS = 14;

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 31, label: '31 days' },
] as const;

/**
 * A routine's compliance log, "transposed": checklist items down the side,
 * occurrence dates across the top (Module Logic §4.2). Ordinary lists answer
 * "was yesterday done?"; this answers "has the restroom check been missed for
 * three weeks?".
 *
 * Read-only and branch-local. Each column is one generated task, so a cell
 * links nowhere it could change anything.
 */
export default function RoutineLogPage() {
  const params = useParams<{ id: string }>();
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayView = hasPermission(branchPermissions, 'tasks.reports.view');
  const mayExport = hasPermission(branchPermissions, 'reports.export');

  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(7);
  const [end, setEnd] = useState(() => branchToday(tz));
  const [log, setLog] = useState<RoutineLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = addCalendarDays(end, -(days - 1));

  useEffect(() => {
    if (!ctx || !mayView) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await tasksApi.routineLog(ctx, params.id, from, end);
        if (!cancelled) {
          setLog(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the log');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, mayView, params.id, from, end]);

  if (!mayView) {
    return (
      <section>
        <h1>Compliance log</h1>
        <p className={styles.empty}>You do not have access to routine reports at this branch.</p>
      </section>
    );
  }

  const byDate = new Map((log?.occurrences ?? []).map((o) => [o.date, o]));
  const pdfTooLong = days > PDF_MAX_DAYS;

  const download = async (format: 'xlsx' | 'pdf') => {
    if (!ctx) return;
    setExporting(format);
    setExportError(null);
    try {
      saveFile(await tasksApi.exportRoutineLog(ctx, params.id, from, end, format));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'The export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <section>
      <div className={styles.bar}>
        <Link href="/tasks/routines" className={styles.link}>
          ← Routines
        </Link>
      </div>
      <h1>{log?.routine_name ?? 'Compliance log'}</h1>
      <p className={styles.hint}>
        {formatCalendarDate(from)} to {formatCalendarDate(end)} · branch dates ({tz}). ✓ done · ✗ not done · — no
        occurrence.
      </p>

      <div className={styles.bar}>
        <button type="button" className={styles.action} onClick={() => setEnd(addCalendarDays(end, -days))}>
          Earlier
        </button>
        <button type="button" className={styles.action} onClick={() => setEnd(branchToday(tz))}>
          Today
        </button>
        <button type="button" className={styles.action} onClick={() => setEnd(addCalendarDays(end, days))}>
          Later
        </button>
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            className={styles.action}
            aria-pressed={days === w.days}
            onClick={() => setDays(w.days)}
          >
            {w.label}
          </button>
        ))}
        {mayExport ? (
          <>
            <button
              type="button"
              className={styles.action}
              disabled={exporting !== null || !log || log.dates.length === 0}
              onClick={() => void download('xlsx')}
            >
              {exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={exporting !== null || !log || log.dates.length === 0 || pdfTooLong}
              onClick={() => void download('pdf')}
            >
              {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </button>
          </>
        ) : null}
      </div>
      {mayExport && pdfTooLong ? (
        <p className={styles.hint}>A PDF covers up to {PDF_MAX_DAYS} days; use Excel for {days} days.</p>
      ) : null}
      {exportError ? (
        <div role="alert" className={styles.error}>
          {exportError}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}

      {!log ? (
        error ? null : (
          <p role="status" aria-live="polite">
            Loading the log…
          </p>
        )
      ) : log.dates.length === 0 ? (
        <p className={styles.empty}>This routine generated no tasks in these dates.</p>
      ) : (
        <div className={styles.logWrap}>
          <table className={styles.log}>
            <caption className="sr-only">
              {log.routine_name}: checklist items by date
            </caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                {log.dates.map((d) => {
                  const o = byDate.get(d);
                  return (
                    <th key={d} scope="col">
                      <Link href={`/tasks/${o?.task_id ?? ''}`} className={styles.link}>
                        {formatCalendarDate(d).slice(0, 5)}
                      </Link>
                      {o?.late ? <div className={styles.hint}>late</div> : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {log.rows.map((row) => (
                <tr key={`${row.kind}:${row.label}`}>
                  <th scope="row">{row.label}</th>
                  {log.dates.map((d) => {
                    const cell = row.cells[d];
                    if (!cell) return <td key={d}>—</td>;
                    return (
                      <td key={d} className={cell.done ? styles.cellDone : styles.cellMissed}>
                        {cell.value ?? (cell.done ? '✓' : '✗')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
