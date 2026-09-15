'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi } from '@/lib/tasks/api';
import { when } from '@/components/tasks/task-card';
import { WEEKDAY_LABEL, type ChecklistTemplate, type Routine } from '@/lib/tasks/types';
import styles from '@/components/tasks/tasks.module.css';

/**
 * Routine management.
 *
 * Operators manage ROUTINES, not cron jobs: a frequency, a time of day in the
 * branch's own clock, and optionally a checklist. Nothing here exposes the
 * scheduler. "Generate due tasks now" is the same idempotent operation the
 * background job calls, so pressing it twice is harmless and it still works if
 * the scheduler is switched off entirely.
 */
export default function RoutinesPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayManage = hasPermission(branchPermissions, 'tasks.routine.manage');
  const mayViewLog = hasPermission(branchPermissions, 'tasks.reports.view');

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The empty state is a claim that there is nothing to show; it may only be
  // made once a list has actually loaded, never after a refused or failed load.
  const [listed, setListed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    name: '',
    frequency: 'DAILY' as 'DAILY' | 'WEEKLY',
    time_of_day: '09:00',
    due_time: '',
    weekdays: [] as number[],
    checklist_template_id: '',
  });

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const [r, c] = await Promise.all([
        tasksApi.listRoutines(ctx),
        tasksApi.listChecklists(ctx).catch(() => null),
      ]);
      setRoutines(r.data);
      setListed(true);
      if (c) setChecklists(c.data.filter((x) => x.status === 'ACTIVE'));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load routines');
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  /**
   * Run an action, then always reconcile. An action may RETURN its own message
   * — "Generated 2 tasks" is more useful than a generic acknowledgement, and
   * the fallback would otherwise overwrite it.
   */
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const message = await fn();
      setNotice(typeof message === 'string' ? message : fallback);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const toggleWeekday = (day: number) =>
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(day)
        ? f.weekdays.filter((d) => d !== day)
        : [...f.weekdays, day].sort((a, b) => a - b),
    }));

  // "HH:MM" strings compare in clock order; the server applies the same rule.
  const deadlineValid = !form.due_time || form.due_time >= form.time_of_day;
  const formValid =
    form.name.trim() && (form.frequency === 'DAILY' || form.weekdays.length > 0) && deadlineValid;

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading routines…
      </p>
    );
  }

  return (
    <>
      <h1>Routines</h1>

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

      <div className={styles.bar}>
        <span className={styles.meta}>{routines.length} routines</span>
        <span className={styles.spacer} />
        {mayManage ? (
          <>
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await tasksApi.materialize(ctx!);
                  return result.created > 0
                    ? `Generated ${result.created} task${result.created === 1 ? '' : 's'}.`
                    : 'Nothing due — everything is already generated.';
                }, 'Done.')
              }
            >
              Generate due tasks now
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.primary}`}
              onClick={() => setShowForm((s) => !s)}
              aria-expanded={showForm}
            >
              {showForm ? 'Close' : 'New routine'}
            </button>
          </>
        ) : null}
      </div>

      {showForm && mayManage ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await tasksApi.createRoutine(ctx!, {
                name: form.name.trim(),
                frequency: form.frequency,
                time_of_day: form.time_of_day,
                ...(form.due_time ? { due_time: form.due_time } : {}),
                ...(form.frequency === 'WEEKLY' ? { weekdays: form.weekdays } : {}),
                ...(form.checklist_template_id
                  ? { checklist_template_id: form.checklist_template_id }
                  : {}),
              });
              setForm({
                name: '',
                frequency: 'DAILY',
                time_of_day: '09:00',
                due_time: '',
                weekdays: [],
                checklist_template_id: '',
              });
              setShowForm(false);
            }, 'Routine created.');
          }}
        >
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="r-name">
                Name
              </label>
              <input
                id="r-name"
                className={styles.input}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="r-frequency">
                Repeats
              </label>
              <select
                id="r-frequency"
                className={styles.select}
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as 'DAILY' | 'WEEKLY' })}
              >
                <option value="DAILY">Every day</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="r-time">
                At (branch local time)
              </label>
              <input
                id="r-time"
                type="time"
                className={styles.input}
                value={form.time_of_day}
                onChange={(e) => setForm({ ...form, time_of_day: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={styles.label} htmlFor="r-due">
              Deadline (optional, branch local time)
            </label>
            <input
              id="r-due"
              type="time"
              className={styles.input}
              value={form.due_time}
              onChange={(e) => setForm({ ...form, due_time: e.target.value })}
            />
            <p className={styles.hint}>
              {deadlineValid
                ? 'When set, each generated task is due by this time the same day; missing it counts as overdue.'
                : 'The deadline cannot be earlier than the routine’s time.'}
            </p>
          </div>

          {form.frequency === 'WEEKLY' ? (
            <div>
              <span className={styles.label}>On</span>
              <div className={styles.filters} role="group" aria-label="Weekdays">
                {WEEKDAY_LABEL.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className={`${styles.chip} ${form.weekdays.includes(day) ? styles.chipActive : ''}`}
                    aria-pressed={form.weekdays.includes(day)}
                    onClick={() => toggleWeekday(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label className={styles.label} htmlFor="r-checklist">
              Checklist (optional)
            </label>
            <select
              id="r-checklist"
              className={styles.select}
              value={form.checklist_template_id}
              onChange={(e) => setForm({ ...form, checklist_template_id: e.target.value })}
            >
              <option value="">No checklist</option>
              {checklists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className={styles.hint}>
              Copied onto every task this routine generates, so later edits never change past work.
            </p>
          </div>

          <div className={styles.actions}>
            <button
              type="submit"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !formValid}
            >
              Create routine
            </button>
          </div>
        </form>
      ) : null}

      {!listed ? null : routines.length === 0 ? (
        <p className={styles.empty}>No routines yet.</p>
      ) : (
        <ul className={styles.list}>
          {routines.map((r) => (
            <li key={r.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.titleLink} style={{ color: 'inherit' }}>
                  {r.name}
                </span>
                <span className={`${styles.badge} ${r.status === 'ACTIVE' ? styles.badgeProgress : styles.badgeCancelled}`}>
                  {r.status === 'ACTIVE' ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className={styles.meta}>
                {r.frequency === 'DAILY'
                  ? `Every day at ${r.time_of_day}`
                  : `${r.weekdays.map((d) => WEEKDAY_LABEL[d]).join(', ')} at ${r.time_of_day}`}
                {r.due_time ? `, due by ${r.due_time}` : ''}
                {r.checklist_name ? ` · ${r.checklist_name}` : ''}
                {r.default_assignee ? ` · ${r.default_assignee.name}` : ''}
              </div>
              {r.next_occurrence_at ? (
                <div className={styles.meta}>Next: {when(r.next_occurrence_at)}</div>
              ) : null}
              {mayViewLog ? (
                <div className={styles.meta}>
                  <Link href={`/tasks/routines/${r.id}/log`} className={styles.link}>
                    Compliance log
                  </Link>
                </div>
              ) : null}
              {mayManage ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          r.status === 'ACTIVE'
                            ? tasksApi.deactivateRoutine(ctx!, r.id)
                            : tasksApi.activateRoutine(ctx!, r.id),
                        r.status === 'ACTIVE' ? 'Routine paused.' : 'Routine resumed.',
                      )
                    }
                  >
                    {r.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
