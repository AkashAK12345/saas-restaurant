'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi } from '@/lib/tasks/api';
import type { ReferenceChecklist, Routine } from '@/lib/tasks/types';
import { branchToday, deviceTimeZone } from '@/lib/format/datetime';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import { QUICK_ACCESS_ITEMS } from '@/lib/tasks/quick-access';
import chrome from '@/components/app/screen-chrome.module.css';
import taskStyles from '@/components/tasks/tasks.module.css';
import styles from '@/components/tasks/task-dashboard.module.css';

type Phase =
  | 'loading'
  | 'no-such-shortcut'
  | 'not-reference'
  | 'need-checklist-setup'
  | 'need-routine-setup'
  | 'waiting-for-task'
  | 'redirecting'
  | 'error';

/**
 * A Quick Access tile's destination.
 *
 * For the ten shortcuts with a backend reference checklist (EOD Report,
 * Operational Checklist, Kitchen Checklist, Branch Head Opening, Banquet
 * Opening, Kitchen Balance/Wastage/Stock Request, Biryani Sales, Corporate
 * Branch Visit): this page finds — or, for someone who may manage checklists
 * and routines, quietly sets up — a daily routine behind the tile, then opens
 * today's task directly, with the ordinary checklist-filling screen already
 * built for /tasks/[id].
 *
 * The other two (Branch Manager Checklist, Activity Calendar) have no backend
 * definition yet — the source names the first's purpose but not its items,
 * and the second isn't a checklist at all — so they still open to a plain
 * "being built" placeholder.
 */
export default function TaskQuickAccessPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const { selectedCompanyId, selectedBranchId, selectedBranch, companyPermissions, branchPermissions } =
    useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const item = QUICK_ACCESS_ITEMS.find((i) => i.key === params.key);
  const mayManageChecklists = hasPermission(companyPermissions, 'tasks.checklist.manage');
  const mayManageRoutines = hasPermission(branchPermissions, 'tasks.routine.manage');

  const [internalPhase, setPhase] = useState<Phase>('loading');
  const [reference, setReference] = useState<ReferenceChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((n) => n + 1);

  useEffect(() => {
    if (!item || !ctx) return;

    let cancelled = false;

    void (async () => {
      setPhase('loading');
      setError(null);
      try {
        const library = await tasksApi.referenceLibrary(ctx);
        const entry = library.find((r) => r.key === item.key) ?? null;
        if (cancelled) return;
        setReference(entry);
        if (!entry) {
          setPhase('not-reference');
          return;
        }

        // 1. The checklist template this routine will use.
        let templateId: string;
        if (entry.installed) {
          const templates = await tasksApi.listChecklists(ctx);
          const existing = templates.data.find((t) => t.name === entry.name);
          if (!existing) throw new Error(`${entry.name} could not be found in the checklist library.`);
          templateId = existing.id;
        } else if (mayManageChecklists) {
          const installed = await tasksApi.installReference(ctx, entry.key);
          templateId = installed.id;
        } else {
          if (!cancelled) setPhase('need-checklist-setup');
          return;
        }
        if (cancelled) return;

        // 2. A daily routine at this branch using it.
        const routines = await tasksApi.listRoutines(ctx);
        let routine: Routine | undefined = routines.data.find(
          (r) => r.checklist_template_id === templateId && r.status === 'ACTIVE',
        );
        if (!routine) {
          if (!mayManageRoutines) {
            if (!cancelled) setPhase('need-routine-setup');
            return;
          }
          try {
            routine = await tasksApi.createRoutine(ctx, {
              name: entry.name,
              description: entry.description,
              frequency: 'DAILY',
              // Available from the start of the branch's day; due by its end —
              // this is an on-demand daily report, not a fixed-time routine.
              time_of_day: '00:00',
              due_time: '23:59',
              checklist_template_id: templateId,
            });
          } catch (e) {
            // Someone already has a routine of this name — reuse it rather
            // than fail outright, even if it isn't the one we just linked.
            const refreshed = await tasksApi.listRoutines(ctx);
            const byName = refreshed.data.find((r) => r.name === entry.name);
            if (!byName) throw e;
            routine = byName;
          }
        }
        if (cancelled || !routine) return;
        const routineId = routine.id;

        // 3. Today's occurrence. The scheduler materialises it within
        // minutes of midnight; someone who may manage routines can also
        // force it now rather than wait.
        const today = branchToday(tz);
        const findTodaysTask = async () => {
          const tasks = await tasksApi.list(ctx, { routine_id: routineId, limit: 50 });
          return tasks.data.find((t) => t.routine_occurrence_date === today) ?? null;
        };
        let task = await findTodaysTask();
        if (!task && mayManageRoutines) {
          await tasksApi.materialize(ctx);
          task = await findTodaysTask();
        }
        if (cancelled) return;
        if (!task) {
          setPhase('waiting-for-task');
          return;
        }

        setPhase('redirecting');
        router.replace(`/tasks/${task.id}`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Something went wrong.');
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ctx, item, tz, mayManageChecklists, mayManageRoutines, router, attempt]);

  // The "no shortcut" and "still loading context" cases are derived, not
  // stored: nothing needs a setState call from inside the effect for them.
  const phase: Phase = !item ? 'no-such-shortcut' : !ctx ? 'loading' : internalPhase;
  const title = item?.title ?? 'Not found';

  return (
    <>
      <ScreenHeader crumb="Tasks · Quick Access" title={title} plain />
      <div className={chrome.content}>
        {phase === 'loading' || phase === 'redirecting' ? (
          <div className={styles.placeholder}>
            {item ? (
              <span className={styles.placeholderTile}>
                <AppIcon name={item.icon} size={30} />
              </span>
            ) : null}
            <p className={styles.placeholderTitle}>{title}</p>
            <p className={styles.placeholderNote}>
              {phase === 'redirecting' ? "Opening today's task…" : 'Loading…'}
            </p>
          </div>
        ) : phase === 'no-such-shortcut' ? (
          <div className={styles.placeholder}>
            <p className={styles.placeholderTitle}>No such shortcut</p>
            <Link href="/tasks">&larr; Back to Task Dashboard</Link>
          </div>
        ) : phase === 'not-reference' && item ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTile}>
              <AppIcon name={item.icon} size={30} />
            </span>
            <p className={styles.placeholderTitle}>{item.title}</p>
            <p className={styles.placeholderNote}>{item.description} — this screen is being built next.</p>
            <Link href="/tasks">&larr; Back to Task Dashboard</Link>
          </div>
        ) : phase === 'need-checklist-setup' && item ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTile}>
              <AppIcon name={item.icon} size={30} />
            </span>
            <p className={styles.placeholderTitle}>{item.title}</p>
            <p className={styles.placeholderNote}>
              {item.title} hasn&rsquo;t been set up for your company yet. Someone with checklist permissions can set
              it up from Checklists.
            </p>
            <div className={taskStyles.actions}>
              <Link href="/tasks/checklists" className={`${taskStyles.action} ${taskStyles.primary}`}>
                Go to Checklists
              </Link>
              <button type="button" className={taskStyles.action} onClick={retry}>
                Check again
              </button>
            </div>
          </div>
        ) : phase === 'need-routine-setup' && item ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTile}>
              <AppIcon name={item.icon} size={30} />
            </span>
            <p className={styles.placeholderTitle}>{item.title}</p>
            <p className={styles.placeholderNote}>
              {item.title} is ready, but no daily routine has been set up for this branch yet. Someone with routine
              permissions can set one up from Routines.
            </p>
            <div className={taskStyles.actions}>
              <Link href="/tasks/routines" className={`${taskStyles.action} ${taskStyles.primary}`}>
                Go to Routines
              </Link>
              <button type="button" className={taskStyles.action} onClick={retry}>
                Check again
              </button>
            </div>
          </div>
        ) : phase === 'waiting-for-task' && item ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTile}>
              <AppIcon name={item.icon} size={30} />
            </span>
            <p className={styles.placeholderTitle}>{item.title}</p>
            <p className={styles.placeholderNote}>
              Today&rsquo;s {item.title.toLowerCase()} hasn&rsquo;t been generated yet — it usually appears within a
              few minutes of the branch&rsquo;s day starting.
            </p>
            <div className={taskStyles.actions}>
              <button type="button" className={`${taskStyles.action} ${taskStyles.primary}`} onClick={retry}>
                Check again
              </button>
            </div>
          </div>
        ) : phase === 'error' && item ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTile}>
              <AppIcon name={item.icon} size={30} />
            </span>
            <p className={styles.placeholderTitle}>{item.title}</p>
            {error ? <p role="alert" className={taskStyles.error}>{error}</p> : null}
            <div className={taskStyles.actions}>
              <button type="button" className={`${taskStyles.action} ${taskStyles.primary}`} onClick={retry}>
                Try again
              </button>
              <Link href="/tasks" className={taskStyles.action}>
                &larr; Back to Task Dashboard
              </Link>
            </div>
          </div>
        ) : null}
        {reference && phase !== 'loading' && phase !== 'redirecting' ? (
          <p className={taskStyles.hint} style={{ textAlign: 'center' }}>
            {reference.description}
          </p>
        ) : null}
      </div>
    </>
  );
}
