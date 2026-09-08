'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { tasksApi } from '@/lib/tasks/api';
import type { TaskSummary } from '@/lib/tasks/types';
import styles from '@/components/tasks/tasks.module.css';

/**
 * Task and routine COMPLETION reporting — Phase 9 scope only.
 *
 * Counts and rates for this module's own work, served by one domain endpoint.
 * Not a generic reporting system: no provider registry, no cross-module
 * analytics, no export. That is Phase 10's job, and it can consume this.
 */
const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
] as const;

export default function TaskReportsPage() {
  const { selectedCompanyId, selectedBranchId } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('30');
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    const days = RANGES.find((r) => r.id === range)?.days ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    try {
      setSummary(await tasksApi.summary(ctx, { from: from.toISOString(), to: to.toISOString() }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the summary');
    } finally {
      setLoading(false);
    }
  }, [ctx, range]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading completion summary…
      </p>
    );
  }

  if (error && !summary) {
    return (
      <div role="alert" className={styles.error}>
        <p>{error}</p>
        <button type="button" className={styles.action} onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  if (!summary) return null;
  const s = summary;

  const table = (
    title: string,
    rows: Array<{ label: string; total: number; completed: number; rate: number }>,
    emptyText: string,
  ) => (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      {rows.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <div className={styles.rows}>
          {rows.map((r) => (
            <div key={r.label} className={styles.row}>
              <span>{r.label}</span>
              <span>
                {r.completed}/{r.total} · {r.rate}%
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <h1>Completion</h1>

      <div className={styles.bar}>
        <div className={styles.filters} role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`${styles.chip} ${range === r.id ? styles.chipActive : ''}`}
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className={styles.spacer} />
        <button type="button" className={styles.action} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}

      <div className={styles.tiles}>
        <div className={`${styles.tile} ${styles.tileSuccess}`}>
          <span className={styles.tileValue}>{s.completion_rate}%</span>
          <span className={styles.tileLabel}>Completed</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{s.counts.total}</span>
          <span className={styles.tileLabel}>Tasks</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{s.counts.pending + s.counts.in_progress}</span>
          <span className={styles.tileLabel}>Still open</span>
        </div>
        <div className={`${styles.tile} ${styles.tileDanger}`}>
          <span className={styles.tileValue}>{s.counts.overdue}</span>
          <span className={styles.tileLabel}>Overdue</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{s.counts.cancelled}</span>
          <span className={styles.tileLabel}>Cancelled</span>
        </div>
      </div>

      {table(
        'By routine',
        s.by_routine.map((r) => ({
          label: r.routine_name,
          total: r.total,
          completed: r.completed,
          rate: r.completion_rate,
        })),
        'No tasks in this period.',
      )}

      {table(
        'By assignee',
        s.by_assignee.map((a) => ({
          label: a.assignee_name,
          total: a.total,
          completed: a.completed,
          rate: a.completion_rate,
        })),
        'No tasks in this period.',
      )}
    </>
  );
}
