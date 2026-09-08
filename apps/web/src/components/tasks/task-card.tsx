'use client';

import Link from 'next/link';
import { TASK_STATUS_LABEL, type Task, type TaskStatus } from '@/lib/tasks/types';
import styles from './tasks.module.css';

const BADGE: Record<TaskStatus, string> = {
  PENDING: styles.badgePending,
  IN_PROGRESS: styles.badgeProgress,
  COMPLETED: styles.badgeCompleted,
  CANCELLED: styles.badgeCancelled,
};

export function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * One task on the dashboard.
 *
 * Which actions appear is driven by the STATE MACHINE (an open task can be
 * started or completed; a finished one can do neither) and by the permissions
 * the parent passes down. Hiding a button is a courtesy — the API re-checks
 * both the permission and the transition on every call, and being the assignee
 * grants nothing.
 */
export function TaskCard({
  task,
  busy,
  onStart,
  onComplete,
  onCancel,
}: {
  task: Task;
  busy?: boolean;
  onStart?: (t: Task) => void;
  onComplete?: (t: Task) => void;
  onCancel?: (t: Task) => void;
}) {
  const open = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
  const progress = task.checklist_progress;
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <li
      className={[
        styles.card,
        task.priority === 'HIGH' ? styles.cardHigh : '',
        task.overdue ? styles.cardOverdue : '',
        open ? '' : styles.cardDone,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.cardTop}>
        <Link href={`/tasks/${task.id}`} className={styles.titleLink}>
          {task.title}
        </Link>
        <span className={`${styles.badge} ${BADGE[task.status]}`}>
          {TASK_STATUS_LABEL[task.status]}
        </span>
        {task.priority === 'HIGH' ? (
          <span className={`${styles.badge} ${styles.badgeHigh}`}>High</span>
        ) : null}
        <span className={styles.spacer} />
        {task.due_at ? (
          <span className={task.overdue ? styles.overdueTag : styles.meta}>
            {task.overdue ? 'Overdue · ' : 'Due '}
            {when(task.due_at)}
          </span>
        ) : null}
      </div>

      <div className={styles.meta}>
        {task.assignee ? `Assigned to ${task.assignee.name}` : 'Unassigned'}
        {task.routine_name ? ` · ${task.routine_name}` : ''}
        {task.completer ? ` · Completed by ${task.completer.name}` : ''}
      </div>

      {progress.total > 0 ? (
        <div className={styles.progress}>
          <span className={styles.progressBar} aria-hidden="true">
            <span className={styles.progressFill} style={{ width: `${pct}%` }} />
          </span>
          <span>
            {progress.done}/{progress.total} done
            {progress.required_total > 0 && !progress.ready_to_complete
              ? ` · ${progress.required_total - progress.required_done} required left`
              : ''}
          </span>
        </div>
      ) : null}

      {open && (onStart || onComplete || onCancel) ? (
        <div className={styles.actions}>
          {task.status === 'PENDING' && onStart ? (
            <button type="button" className={styles.action} disabled={busy} onClick={() => onStart(task)}>
              Start
            </button>
          ) : null}
          {onComplete ? (
            <button
              type="button"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !progress.ready_to_complete}
              onClick={() => onComplete(task)}
              title={
                progress.ready_to_complete ? undefined : 'Required checklist items are still outstanding'
              }
            >
              Complete
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className={`${styles.action} ${styles.danger}`}
              disabled={busy}
              onClick={() => onCancel(task)}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
