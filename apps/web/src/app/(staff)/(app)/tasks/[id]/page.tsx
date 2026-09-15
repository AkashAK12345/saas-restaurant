'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi } from '@/lib/tasks/api';
import { when } from '@/components/tasks/task-card';
import { ChecklistAnswer } from '@/components/tasks/checklist-answer';
import {
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type StaffRef,
  type TaskComment,
  type TaskDetail,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/types';
import styles from '@/components/tasks/tasks.module.css';

const BADGE: Record<TaskStatus, string> = {
  PENDING: styles.badgePending,
  IN_PROGRESS: styles.badgeProgress,
  COMPLETED: styles.badgeCompleted,
  CANCELLED: styles.badgeCancelled,
};

/** An instant as the value a `datetime-local` input shows, in this device's clock. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One task: its details, checklist, assignment, lifecycle and comments.
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

  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [staff, setStaff] = useState<StaffRef[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ title: '', description: '', priority: 'NORMAL' as TaskPriority, due: '' });

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const [t, c] = await Promise.all([
        tasksApi.get(ctx, taskId),
        // Comments are secondary: a failure here must not hide the task.
        tasksApi.comments(ctx, taskId).catch(() => null),
      ]);
      setTask(t);
      if (c) setComments(c);
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

  // The assignment picker offers exactly the people the API accepts.
  useEffect(() => {
    if (!ctx || !may.assign) return;
    let cancelled = false;
    void (async () => {
      try {
        const people = await tasksApi.assignableStaff(ctx);
        if (!cancelled) setStaff(people);
      } catch {
        if (!cancelled) setStaff([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, may.assign]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
      return false;
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

  const startEditing = () => {
    setEdit({
      title: t.title,
      description: t.description ?? '',
      priority: t.priority,
      due: toLocalInput(t.due_at),
    });
    setEditing(true);
  };

  /** Only fields that actually changed are sent. */
  const saveEdit = async () => {
    const body: Parameters<typeof tasksApi.update>[2] = {};
    if (edit.title.trim() !== t.title) body.title = edit.title.trim();
    const description = edit.description.trim() || null;
    if (description !== t.description) body.description = description;
    if (edit.priority !== t.priority) body.priority = edit.priority;
    const due = edit.due ? new Date(edit.due).toISOString() : null;
    if (due !== (t.due_at ? new Date(t.due_at).toISOString() : null)) body.due_at = due;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    if (await run(() => tasksApi.update(ctx!, t.id, body), 'Task updated.')) setEditing(false);
  };

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
          {may.update && !editing ? (
            <button type="button" className={styles.action} disabled={busy} onClick={startEditing}>
              Edit details
            </button>
          ) : null}
        </div>
      ) : null}

      {editing && open && may.update ? (
        <form
          className={styles.form}
          aria-label="Edit task"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit();
          }}
        >
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="e-title">
                Title
              </label>
              <input
                id="e-title"
                className={styles.input}
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="e-priority">
                Priority
              </label>
              <select
                id="e-priority"
                className={styles.select}
                value={edit.priority}
                onChange={(e) => setEdit({ ...edit, priority: e.target.value as TaskPriority })}
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="e-due">
                Due
              </label>
              <input
                id="e-due"
                type="datetime-local"
                className={styles.input}
                value={edit.due}
                onChange={(e) => setEdit({ ...edit, due: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={styles.label} htmlFor="e-notes">
              Notes
            </label>
            <textarea
              id="e-notes"
              className={styles.textarea}
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </div>
          <div className={styles.actions}>
            <button
              type="submit"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !edit.title.trim()}
            >
              Save changes
            </button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => setEditing(false)}>
              Discard
            </button>
          </div>
        </form>
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
            <span>
              {t.assignee?.name ?? 'Nobody'}
              {t.assignee && t.assigner ? ` · by ${t.assigner.name}` : ''}
            </span>
          </div>
          {t.reassignment_count > 0 ? (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Reassigned</span>
              <span>
                {t.reassignment_count} {t.reassignment_count === 1 ? 'time' : 'times'}
              </span>
            </div>
          ) : null}
          <div className={styles.row}>
            <span className={styles.rowLabel}>Source</span>
            <span>
              {t.routine_name
                ? `Routine · ${t.routine_name}`
                : t.creator
                  ? `Raised by ${t.creator.name}`
                  : 'Created by hand'}
            </span>
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
            {t.checklist.map((item) =>
              item.kind === 'CHECK' ? (
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
              ) : (
                <li key={item.id} className={`${styles.item} ${item.is_done ? styles.itemDone : ''}`}>
                  <ChecklistAnswer
                    item={item}
                    disabled={busy || !open || !may.update}
                    onSave={(value) =>
                      void run(() => tasksApi.setChecklistItem(ctx!, t.id, item.id, true, value), 'Answer saved.')
                    }
                    onClear={() =>
                      void run(() => tasksApi.setChecklistItem(ctx!, t.id, item.id, false), 'Answer cleared.')
                    }
                  />
                </li>
              ),
            )}
          </ul>
          {!progress.ready_to_complete && open ? (
            <p className={styles.hint}>
              Required items (*) must be ticked or answered before this task can be completed.
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
            <label className="sr-only" htmlFor="a-assignee">
              Assign to
            </label>
            <select
              id="a-assignee"
              className={styles.select}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose a person…</option>
              {staff
                .filter((s) => s.id !== t.assignee_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !assigneeId}
              onClick={() =>
                void run(async () => {
                  await tasksApi.assign(ctx!, t.id, assigneeId);
                  setAssigneeId('');
                }, t.assignee_id ? 'Task reassigned.' : 'Task assigned.')
              }
            >
              {t.assignee_id ? 'Reassign' : 'Assign'}
            </button>
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

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Comments</h2>
        {comments === null ? null : comments.length === 0 ? (
          <p className={styles.empty}>No comments yet.</p>
        ) : (
          <ul className={styles.items} aria-label="Comments">
            {comments.map((c) => (
              <li key={c.id} className={styles.item}>
                <span>
                  <strong>{c.author.name}</strong>{' '}
                  <span className={styles.meta}>{when(c.created_at)}</span>
                  <br />
                  {c.body}
                </span>
              </li>
            ))}
          </ul>
        )}
        {may.update ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const body = commentBody.trim();
              if (!body) return;
              void run(async () => {
                await tasksApi.addComment(ctx!, t.id, body);
                setCommentBody('');
              }, 'Comment added.');
            }}
          >
            <label className={styles.label} htmlFor="c-body">
              Add a comment
            </label>
            <textarea
              id="c-body"
              className={styles.textarea}
              value={commentBody}
              maxLength={2000}
              onChange={(e) => setCommentBody(e.target.value)}
            />
            <p className={styles.hint}>Comments are kept as part of the task’s history and cannot be edited.</p>
            <div className={styles.actions}>
              <button
                type="submit"
                className={`${styles.action} ${styles.primary}`}
                disabled={busy || !commentBody.trim()}
              >
                Post comment
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}
