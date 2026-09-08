'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi } from '@/lib/tasks/api';
import { when } from '@/components/tasks/task-card';
import {
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type TaskDetail,
  type TaskStatus,
} from '@/lib/tasks/types';
import styles from '@/components/tasks/tasks.module.css';

const BADGE: Record<TaskStatus, string> = {
  PENDING: styles.badgePending,
  IN_PROGRESS: styles.badgeProgress,
  COMPLETED: styles.badgeCompleted,
  CANCELLED: styles.badgeCancelled,
};

/**
 * One task: its checklist, its assignment and its lifecycle.
 *
 * The completion button is disabled until the SERVER says the required items
 * are done (`ready_to_complete`), and the server refuses regardless — the
 * frontend gate is a courtesy, not the rule.
 */
export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const may = {
    update: hasPermission(branchPermissions, 'tasks.update'),
    assign: hasPermission(branchPermissions, 'tasks.assign'),
    start: hasPermission(branchPermissions, 'tasks.start'),
    complete: hasPermission(branchPermissions, 'tasks.complete'),
    cancel: hasPermission(branchPermissions, 'tasks.cancel'),
  };

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Two error slots: a failed action is followed by a refetch, and that
  // refetch succeeding must not erase why the action failed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      setTask(await tasksApi.get(ctx, taskId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the task');
    } finally {
      setLoading(false);
    }
  }, [ctx, taskId]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading task…
      </p>
    );
  }

  if (!task) {
    return (
      <div role="alert" className={styles.error}>
        <p>{loadError ?? 'Task not found.'}</p>
        <Link href="/tasks">Back to tasks</Link>
      </div>
    );
  }

  const t = task;
  const open = t.status === 'PENDING' || t.status === 'IN_PROGRESS';
  const progress = t.checklist_progress;

  return (
    <>
      <div className={styles.bar}>
        <Link href="/tasks">← Tasks</Link>
        <span className={styles.spacer} />
        <span className={`${styles.badge} ${BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
      </div>

      <h1>{t.title}</h1>

      {actionError ? (
        <div role="alert" className={styles.error}>
          {actionError}
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className={styles.error}>
          {loadError}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      {open ? (
        <div className={styles.actions} style={{ marginBottom: 'var(--gap-lg)' }}>
          {t.status === 'PENDING' && may.start ? (
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => void run(() => tasksApi.start(ctx!, t.id), 'Task started.')}
            >
              Start
            </button>
          ) : null}
          {may.complete ? (
            <button
              type="button"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !progress.ready_to_complete}
              onClick={() => void run(() => tasksApi.complete(ctx!, t.id), 'Task completed.')}
            >
              Complete
            </button>
          ) : null}
          {may.cancel ? (
            <button
              type="button"
              className={`${styles.action} ${styles.danger}`}
              disabled={busy}
              onClick={() => void run(() => tasksApi.cancel(ctx!, t.id), 'Task cancelled.')}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Details</h2>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Priority</span>
            <span>{PRIORITY_LABEL[t.priority]}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Due</span>
            <span className={t.overdue ? styles.overdueTag : undefined}>
              {t.due_at ? `${when(t.due_at)}${t.overdue ? ' · overdue' : ''}` : '—'}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Assigned to</span>
            <span>{t.assignee?.name ?? 'Nobody'}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Source</span>
            <span>{t.routine_name ? `Routine · ${t.routine_name}` : 'Created by hand'}</span>
          </div>
          {t.description ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Notes</span>
              <span>{t.description}</span>
            </div>
          ) : null}
          {t.completed_at ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Completed</span>
              <span>
                {when(t.completed_at)}
                {t.completer ? ` by ${t.completer.name}` : ''}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {t.checklist.length > 0 ? (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Checklist</h2>
          <p className={styles.hint}>
            {progress.done} of {progress.total} done
            {progress.required_total > 0
              ? ` · ${progress.required_done}/${progress.required_total} required`
              : ''}
            {progress.ready_to_complete ? ' · ready to complete' : ''}
          </p>
          <ul className={styles.items}>
            {t.checklist.map((item) => (
              <li key={item.id} className={`${styles.item} ${item.is_done ? styles.itemDone : ''}`}>
                <input
                  id={`ck-${item.id}`}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={item.is_done}
                  disabled={busy || !open || !may.update}
                  onChange={(e) =>
                    void run(
                      () => tasksApi.setChecklistItem(ctx!, t.id, item.id, e.target.checked),
                      e.target.checked ? 'Item ticked.' : 'Item cleared.',
                    )
                  }
                />
                <label className={styles.itemLabel} htmlFor={`ck-${item.id}`}>
                  {item.label}
                  {item.is_required ? (
                    <span className={styles.required} title="Required">
                      {' '}
                      *
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          {!progress.ready_to_complete && open ? (
            <p className={styles.hint}>
              Required items (*) must be ticked before this task can be completed.
            </p>
          ) : null}
        </section>
      ) : null}

      {may.assign && open ? (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Assignment</h2>
          <p className={styles.hint}>
            Assignment records who is responsible. It does not change what anyone is permitted to do.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              disabled={busy || !t.assignee_id}
              onClick={() => void run(() => tasksApi.assign(ctx!, t.id, null), 'Assignment cleared.')}
            >
              Clear assignment
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
