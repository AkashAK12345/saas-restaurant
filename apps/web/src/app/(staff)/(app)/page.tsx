'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { reportsApi } from '@/lib/reports/api';
import { branchToday, formatDateLabel, shiftDate } from '@/lib/reports/format';
import { deviceTimeZone } from '@/lib/format/datetime';
import { MetricGrid } from '@/components/reports/metric-grid';
import { WidgetCard } from '@/components/reports/widget-card';
import { WorkspaceGrid } from '@/components/shell/workspace-grid';
import { branchDateLabel, greetingFor } from '@/components/shell/greeting';
import type { AllBranchesDashboardResponse, DashboardResponse } from '@/lib/reports/types';
import styles from '@/components/reports/reports.module.css';

type Preset = 'today' | '7d' | '30d' | 'month';
type Scope = 'branch' | 'all';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
];

/**
 * Branch-local window for a preset. "Last 30 days" sends no dates at all: it
 * is the server's own default, resolved in each branch's timezone.
 */
function windowFor(preset: Preset, timezone: string): { from?: string; to?: string } {
  if (preset === '30d') return {};
  const today = branchToday(timezone);
  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') return { from: shiftDate(today, -6), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * The dashboard — the home screen for an authenticated operator.
 *
 * ONE REQUEST fills the whole page: the server aggregates every widget the
 * caller may see and returns them together. Fetching a tile at a time would
 * multiply round trips and repeat the same authorization work per call.
 *
 * The tiles that appear are decided by the SERVER, from the caller's branch
 * permissions. Hiding a tile here would protect nothing; the server simply
 * never sends one the viewer may not see. "All branches" is the same rule
 * applied branch by branch, summed where summing is honest.
 */
export default function HomePage() {
  const { user } = useAuth();
  const { selectedCompanyId, selectedBranchId, selectedBranch, branches, branchPermissions, companyPermissions } =
    useAppContext();

  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayViewDashboard = hasPermission(branchPermissions, 'dashboard.view');
  const mayViewReports = hasPermission(branchPermissions, 'reports.view');
  const offerAllBranches = (branches?.length ?? 0) > 1;
  const zone = selectedBranch?.timezone ?? deviceTimeZone();

  const [preset, setPreset] = useState<Preset>('30d');
  const [scope, setScope] = useState<Scope>('branch');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [allBranches, setAllBranches] = useState<AllBranchesDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    setError(null);
    const { from, to } = windowFor(preset, zone);
    try {
      if (scope === 'all') {
        setAllBranches(await reportsApi.dashboardAllBranches(ctx, from, to));
      } else {
        setDashboard(await reportsApi.dashboard(ctx, from, to));
      }
    } catch (e) {
      if (scope === 'all') setAllBranches(null);
      else setDashboard(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ctx, preset, scope, zone]);

  useEffect(() => {
    if (!ctx || !mayViewDashboard) return;
    // Deferred into a task so the first render is not interrupted by the
    // state the fetch sets on its way in.
    void (async () => {
      await load();
    })();
  }, [ctx, mayViewDashboard, load]);

  // Until the dashboard answers we do not know the branch's zone, so the
  // greeting starts on the device clock and settles on the branch's.
  const timezone = dashboard?.timezone;
  const greeting = `${greetingFor(timezone ?? 'UTC')}${user?.first_name ? `, ${user.first_name}` : ''}`;
  const dateLabel = branchDateLabel(timezone ?? 'UTC');
  const permissions = Array.from(new Set([...companyPermissions, ...branchPermissions]));

  if (!selectedCompanyId) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>{greeting}</h1>
        <p className={styles.notice}>Select a company to get started.</p>
      </section>
    );
  }

  if (!selectedBranchId) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>{greeting}</h1>
        <p className={styles.notice}>Select a branch to see branch operations.</p>
      </section>
    );
  }

  if (!mayViewDashboard) {
    return (
      <section className={styles.page}>
        <header>
          <h1 className={styles.title}>{greeting}</h1>
          <p className={styles.zone}>{dateLabel}</p>
        </header>
        <WorkspaceGrid permissions={permissions} hasBranch={!!selectedBranchId} />
      </section>
    );
  }

  const shown = scope === 'all' ? allBranches : dashboard;
  const windowLabel = dashboard && scope === 'branch'
    ? `${formatDateLabel(dashboard.filters.from)} to ${formatDateLabel(dashboard.filters.to)}`
    : null;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{greeting}</h1>
          <p className={styles.zone}>
            {dateLabel}
            {windowLabel ? ` · ${windowLabel}` : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {mayViewReports ? (
            <Link className={styles.button} href="/reports">
              Reports
            </Link>
          ) : null}
        </div>
      </header>

      <div className={styles.actions} role="group" aria-label="Dashboard period">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${styles.button} ${preset === p.key ? styles.primary : ''}`}
            aria-pressed={preset === p.key}
            onClick={() => setPreset(p.key)}
            disabled={loading}
          >
            {p.label}
          </button>
        ))}
        {offerAllBranches ? (
          <button
            type="button"
            className={`${styles.button} ${scope === 'all' ? styles.primary : ''}`}
            aria-pressed={scope === 'all'}
            onClick={() => setScope((s) => (s === 'all' ? 'branch' : 'all'))}
            disabled={loading}
          >
            All branches
          </button>
        ) : null}
      </div>
      <p className={styles.subtitle}>
        Tiles marked &ldquo;Right now&rdquo; always show the present; the period applies to the others.
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading && !shown ? (
        <p className={styles.notice} role="status" aria-live="polite">
          Loading dashboard…
        </p>
      ) : null}

      {scope === 'branch' && dashboard && dashboard.widgets.length === 0 ? (
        <p className={styles.notice}>Nothing to show yet for this branch.</p>
      ) : null}

      {scope === 'branch' && dashboard ? (
        <div className={styles.cards}>
          {dashboard.widgets.map((widget) => (
            <WidgetCard key={widget.key} widget={widget} timezone={dashboard.timezone} />
          ))}
        </div>
      ) : null}

      {scope === 'all' && allBranches ? (
        <>
          <p className={styles.zone}>
            Totals across {allBranches.branches.length} branches:{' '}
            {allBranches.branches.map((b) => b.name).join(', ')}
          </p>
          <div className={styles.cards}>
            {allBranches.widgets.map((widget) => (
              <div key={widget.key}>
                <WidgetCard widget={widget} timezone={zone} />
                {widget.not_summed.length > 0 ? (
                  <p className={styles.subtitle}>
                    Not added across branches: {widget.not_summed.join(', ')}
                  </p>
                ) : null}
                <details>
                  <summary>By branch</summary>
                  {widget.branches.map((b) => (
                    <div key={b.branch_id}>
                      <h4 className={styles.subtitle}>{b.branch_name}</h4>
                      {b.error ? (
                        <p className={styles.error}>{b.error}</p>
                      ) : (
                        <MetricGrid metrics={b.metrics} timezone={zone} />
                      )}
                    </div>
                  ))}
                </details>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <WorkspaceGrid permissions={permissions} hasBranch={!!selectedBranchId} />
    </section>
  );
}
