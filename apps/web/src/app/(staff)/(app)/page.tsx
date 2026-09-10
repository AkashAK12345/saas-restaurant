'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { reportsApi } from '@/lib/reports/api';
import { WidgetCard } from '@/components/reports/widget-card';
import { WorkspaceGrid } from '@/components/shell/workspace-grid';
import { branchDateLabel, greetingFor } from '@/components/shell/greeting';
import type { DashboardResponse } from '@/lib/reports/types';
import styles from '@/components/reports/reports.module.css';

/**
 * The branch dashboard — the home screen for an authenticated operator.
 *
 * ONE REQUEST fills the whole page: the server aggregates every widget the
 * caller may see and returns them together. Fetching a tile at a time would
 * multiply round trips and repeat the same authorization work per call.
 *
 * The tiles that appear are decided by the SERVER, from the caller's branch
 * permissions. Hiding a tile here would protect nothing; the server simply
 * never sends one the viewer may not see.
 */
export default function HomePage() {
  const { user } = useAuth();
  const { selectedCompanyId, selectedBranchId, branchPermissions, companyPermissions } =
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

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    setError(null);
    try {
      setDashboard(await reportsApi.dashboard(ctx));
    } catch (e) {
      setDashboard(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ctx]);

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

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{greeting}</h1>
          <p className={styles.zone}>{dateLabel}</p>
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

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading && !dashboard ? (
        <p className={styles.notice} role="status" aria-live="polite">
          Loading dashboard…
        </p>
      ) : null}

      {dashboard && dashboard.widgets.length === 0 ? (
        <p className={styles.notice}>
          Nothing to show yet for this branch.
        </p>
      ) : null}

      {dashboard ? (
        <div className={styles.cards}>
          {dashboard.widgets.map((widget) => (
            <WidgetCard key={widget.key} widget={widget} timezone={dashboard.timezone} />
          ))}
        </div>
      ) : null}

      <WorkspaceGrid permissions={permissions} hasBranch={!!selectedBranchId} />
    </section>
  );
}
