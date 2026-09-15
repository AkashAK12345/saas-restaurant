'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { reportsApi } from '@/lib/reports/api';
import { branchToday, formatDateLabel, shiftDate } from '@/lib/reports/format';
import { deviceTimeZone } from '@/lib/format/datetime';
import { SeriesChart } from '@/components/reports/series-chart';
import { WidgetCard } from '@/components/reports/widget-card';
import { formatValue } from '@/lib/reports/format';
import { WorkspaceGrid } from '@/components/shell/workspace-grid';
import { branchDateLabel, greetingFor } from '@/components/shell/greeting';
import type { AllBranchesDashboardResponse, AllBranchesWidget, DashboardResponse } from '@/lib/reports/types';
import styles from '@/components/reports/reports.module.css';

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom';
type Scope = 'branch' | 'all';

const PRESETS: Array<{ key: Exclude<Preset, 'custom'>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
];

/** The server's own limit; checked here only to explain it before a round trip. */
const MAX_RANGE_DAYS = 366;

/**
 * Branch-local window for a preset. "Last 30 days" sends no dates at all: it
 * is the server's own default, resolved in each branch's timezone. A custom
 * window is sent exactly as chosen.
 */
function windowFor(
  preset: Preset,
  timezone: string,
  custom: { from: string; to: string } | null,
): { from?: string; to?: string } {
  if (preset === 'custom') return custom ?? {};
  if (preset === '30d') return {};
  const today = branchToday(timezone);
  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') return { from: shiftDate(today, -6), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

const rangeDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

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
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [scope, setScope] = useState<Scope>('branch');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [allBranches, setAllBranches] = useState<AllBranchesDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    setError(null);
    if (preset === 'custom' && !custom) {
      setLoading(false);
      return;
    }
    const { from, to } = windowFor(preset, zone, custom);
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
  }, [ctx, preset, scope, zone, custom]);

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

  const customProblem = !draft.from || !draft.to
    ? 'Choose both dates.'
    : draft.from > draft.to
      ? 'The start date must not be after the end date.'
      : rangeDays(draft.from, draft.to) > MAX_RANGE_DAYS
        ? `A period may cover at most ${MAX_RANGE_DAYS} days.`
        : null;

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
        <button
          type="button"
          className={`${styles.button} ${preset === 'custom' ? styles.primary : ''}`}
          aria-pressed={preset === 'custom'}
          onClick={() => {
            if (!draft.from) {
              const today = branchToday(zone);
              setDraft({ from: `${today.slice(0, 8)}01`, to: today });
            }
            setPreset('custom');
          }}
          disabled={loading}
        >
          Custom
        </button>
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
      {preset === 'custom' ? (
        <form
          className={styles.filters}
          aria-label="Custom period"
          onSubmit={(e) => {
            e.preventDefault();
            if (customProblem === null) setCustom({ ...draft });
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="dashboard-from">
              From
            </label>
            <input
              id="dashboard-from"
              className={styles.input}
              type="date"
              required
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="dashboard-to">
              To
            </label>
            <input
              id="dashboard-to"
              className={styles.input}
              type="date"
              required
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </div>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={loading || customProblem !== null}>
            Apply
          </button>
          {customProblem ? <p className={styles.subtitle}>{customProblem}</p> : null}
        </form>
      ) : null}
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
              <section
                key={widget.key}
                className={`${styles.widget} ${styles.wide}`}
                aria-labelledby={`all-${widget.key}`}
              >
                <div className={styles.widgetHead}>
                  <h3 className={styles.widgetTitle} id={`all-${widget.key}`}>
                    {widget.title}
                  </h3>
                  {widget.live ? <span className={styles.live}>Right now</span> : null}
                </div>
                <BranchMatrix widget={widget} timezone={zone} />
                {widget.not_summed.length > 0 ? (
                  <p className={styles.subtitle}>
                    Not added across branches: {widget.not_summed.join(', ')}
                  </p>
                ) : null}
                {widget.series ? (
                  <SeriesChart
                    series={widget.series}
                    title={widget.title}
                    branches={widget.branches.map((b) => ({ id: b.branch_id, name: b.branch_name, series: b.series }))}
                  />
                ) : null}
              </section>
            ))}
          </div>
        </>
      ) : null}

      <WorkspaceGrid permissions={permissions} hasBranch={!!selectedBranchId} />
    </section>
  );
}

/**
 * One widget as a branch comparison: a row per figure, an "All branches"
 * column holding the honest sum, then one column per branch. A figure that
 * cannot be added across branches says so in the All column instead of
 * showing a number that would mislead.
 */
function BranchMatrix({ widget, timezone }: { widget: AllBranchesWidget; timezone: string }) {
  const rows = new Map<string, { label: string; type: AllBranchesWidget['metrics'][number]['type'] }>();
  for (const b of widget.branches) for (const m of b.metrics) if (!rows.has(m.key)) rows.set(m.key, { label: m.label, type: m.type });
  for (const m of widget.metrics) if (!rows.has(m.key)) rows.set(m.key, { label: m.label, type: m.type });
  if (rows.size === 0) return null;

  const cell = (metrics: AllBranchesWidget['metrics'], key: string) => {
    const m = metrics.find((x) => x.key === key);
    return m ? formatValue(m.value, m.type, { timezone, currency: m.currency }) : '—';
  };

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label={`${widget.title} by branch`}>
        <thead>
          <tr>
            <th scope="col">Figure</th>
            <th scope="col" className={styles.numeric}>
              All branches
            </th>
            {widget.branches.map((b) => (
              <th key={b.branch_id} scope="col" className={styles.numeric}>
                {b.branch_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([key, row]) => (
            <tr key={key}>
              <th scope="row">{row.label}</th>
              <td className={styles.numeric}>
                {widget.metrics.some((m) => m.key === key) ? cell(widget.metrics, key) : 'Not added'}
              </td>
              {widget.branches.map((b) => (
                <td key={b.branch_id} className={styles.numeric}>
                  {b.error ? 'Unavailable' : cell(b.metrics, key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
