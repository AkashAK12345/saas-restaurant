'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi, type TaskFilters } from '@/lib/tasks/api';
import { useTaskBoard } from '@/lib/tasks/use-task-board';
import { TaskCard } from '@/components/tasks/task-card';
import type { StreamStatus } from '@/lib/realtime/sse-client';
import type { ChecklistTemplate, StaffRef, Task, TaskStatus } from '@/lib/tasks/types';
import styles from '@/components/tasks/tasks.module.css';

const DOT: Record<StreamStatus, string> = {
  idle: styles.dotWaiting,
  connecting: styles.dotWaiting,
  open: styles.dotOpen,
  reconnecting: styles.dotWaiting,
  closed: styles.dotClosed,
};

type Preset = 'open' | 'mine' | 'overdue' | 'unassigned' | 'completed' | 'all';

const PRESETS: Array<{ id: Preset; label: string; filters: TaskFilters }> = [
  { id: 'open', label: 'Pending', filters: { status: 'PENDING' } },
  { id: 'mine', label: 'Assigned to me', filters: { assignee: 'me' } },
  { id: 'overdue', label: 'Overdue', filters: { overdue: true } },
  { id: 'unassigned', label: 'Unassigned', filters: { unassigned: true } },
  { id: 'completed', label: 'Completed', filters: { status: 'COMPLETED' } },
  { id: 'all', label: 'All', filters: {} },
];

/**
 * The task board — every ad-hoc and routine-generated task for the branch,
 * filterable by status, assignee and overdue.
 *
 * Every filter is a SERVER query — the browser never holds the branch's whole
 * task table. Live over SSE and reconciled over REST, and no action is treated
 * as successful until the server says so.
 */
export default function TaskBoardPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const may = {
    create: hasPermission(branchPermissions, 'tasks.create'),
    assign: hasPermission(branchPermissions, 'tasks.assign'),
    start: hasPermission(branchPermissions, 'tasks.start'),
    complete: hasPermission(branchPermissions, 'tasks.complete'),
    cancel: hasPermission(branchPermissions, 'tasks.cancel'),
  };
  // The branch task stream carries everyone's tasks; a viewer limited to their
  // own is refused it, so their board reads over REST only.
  const live = hasPermission(branchPermissions, 'tasks.view');

  const [preset, setPreset] = useState<Preset>('open');
  const filters = useMemo<TaskFilters>(
    () => ({ ...(PRESETS.find((p) => p.id === preset)?.filters ?? {}), limit: 50 }),
    [preset],
  );

  const { tasks, total, loading, error, stream, refresh } = useTaskBoard(ctx, filters, { live });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH'>('NORMAL');
  const [dueAt, setDueAt] = useState('');
  const [checklistId, setChecklistId] = useState('');
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [staff, setStaff] = useState<StaffRef[] | null>(null);

  // The assignee picker offers exactly the people the API accepts; loaded
  // once the form opens, and only for someone allowed to assign.
  useEffect(() => {
    if (!ctx || !showForm || !may.assign || staff !== null) return;
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
  }, [ctx, showForm, may.assign, staff]);

  // Checklists are company-scoped reference data; fetched once the operator
  // opens the form rather than on every dashboard load.
  useEffect(() => {
    if (!ctx || !showForm || checklists.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await tasksApi.listChecklists(ctx);
        if (!cancelled) setChecklists(page.data.filter((c) => c.status === 'ACTIVE'));
      } catch {
        if (!cancelled) setChecklists([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, showForm, checklists.length]);

  /** Run an action, then always reconcile — a request is not a result. */
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

  const statusFilterLabel = (s: TaskStatus | undefined) => s ?? 'all';

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading tasks…
      </p>
    );
  }

  return (
    <>
      <h1>Tasks</h1>

      <div className={styles.bar}>
        <div className={styles.filters} role="group" aria-label="Task filters">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.chip} ${preset === p.id ? styles.chipActive : ''}`}
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className={styles.spacer} />
        <span className={styles.stream} role="status" aria-live="polite">
          <span className={`${styles.dot} ${DOT[stream]}`} aria-hidden="true" />
          {!live ? 'Updates when refreshed' : stream === 'open' ? 'Live' : 'Reconnecting…'}
        </span>
        <button type="button" className={styles.action} onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
        {may.create ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            onClick={() => setShowForm((s) => !s)}
            aria-expanded={showForm}
          >
            {showForm ? 'Close' : 'New task'}
          </button>
        ) : null}
      </div>

      {actionError ? (
        <div role="alert" className={styles.error}>
          {actionError}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      {showForm && may.create ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await tasksApi.create(ctx!, {
                title: title.trim(),
                priority,
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
                ...(assigneeId ? { assignee_id: assigneeId } : {}),
                ...(checklistId ? { checklist_template_id: checklistId } : {}),
              });
              setTitle('');
              setDescription('');
              setDueAt('');
              setPriority('NORMAL');
              setAssigneeId('');
              setChecklistId('');
              setShowForm(false);
            }, 'Task created.');
          }}
        >
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="t-title">
                Title
              </label>
              <input
                id="t-title"
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="t-priority">
                Priority
              </label>
              <select
                id="t-priority"
                className={styles.select}
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'LOW' | 'NORMAL' | 'HIGH')}
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="t-due">
                Due (optional)
              </label>
              <input
                id="t-due"
                type="datetime-local"
                className={styles.input}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          <div className={`${styles.grid} ${may.assign ? styles.grid3 : ''}`}>
            {may.assign ? (
              <div>
                <label className={styles.label} htmlFor="t-assignee">
                  Assign to (optional)
                </label>
                <select
                  id="t-assignee"
                  className={styles.select}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">Nobody yet</option>
                  {(staff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div style={{ gridColumn: may.assign ? 'span 2' : undefined }}>
              <label className={styles.label} htmlFor="t-notes">
                Notes (optional)
              </label>
              <textarea
                id="t-notes"
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={styles.label} htmlFor="t-checklist">
              Checklist (optional)
            </label>
            <select
              id="t-checklist"
              className={styles.select}
              value={checklistId}
              onChange={(e) => setChecklistId(e.target.value)}
            >
              <option value="">No checklist</option>
              {checklists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className={styles.hint}>
              Copied onto the task, so later edits to the checklist never change this one.
            </p>
          </div>

          <div className={styles.actions}>
            <button
              type="submit"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !title.trim()}
            >
              Create task
            </button>
          </div>
        </form>
      ) : null}

      {tasks.length === 0 ? (
        // No empty-state claim when the board failed to load: the alert above
        // says why, and "nothing here" would be untrue.
        error ? null : (
          <p className={styles.empty}>
            Nothing here. {preset === 'all' ? 'No tasks yet.' : 'Try another filter.'}
          </p>
        )
      ) : (
        <>
          <p className={styles.meta}>
            Showing {tasks.length} of {total} ({statusFilterLabel(filters.status)})
          </p>
          <ul className={styles.list}>
            {tasks.map((t: Task) => (
              <TaskCard
                key={t.id}
                task={t}
                busy={busy}
                onStart={may.start ? (x) => void run(() => tasksApi.start(ctx!, x.id), `Started “${x.title}”.`) : undefined}
                onComplete={
                  may.complete
                    ? (x) => void run(() => tasksApi.complete(ctx!, x.id), `Completed “${x.title}”.`)
                    : undefined
                }
                onCancel={
                  may.cancel ? (x) => void run(() => tasksApi.cancel(ctx!, x.id), `Cancelled “${x.title}”.`) : undefined
                }
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
