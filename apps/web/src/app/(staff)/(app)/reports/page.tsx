'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { reportsApi } from '@/lib/reports/api';
import { CHECKLIST_REPORTS, coveredByChecklistReports, reportHref } from '@/lib/reports/checklist-reports';
import type { ReportDefinition } from '@/lib/reports/types';
import { ReportRowContent } from '@/components/reports/report-row';
import styles from '@/components/reports/reports.module.css';
import listStyles from '@/components/reports/reports-sheet.module.css';

/**
 * The Reports page — the same list as the dashboard's Reports sheet, row for
 * row (both read CHECKLIST_REPORTS and draw rows with ReportRowContent), so
 * the module and the dashboard never disagree about what reports there are.
 *
 * Beneath it, "More reports" lists what the server offers this user that no
 * row above already opens — the smaller reports such as outstanding banquet
 * balances or tasks by assignee — so nothing built stays out of reach. That
 * part comes from the SERVER, already filtered to the reports this user may
 * run.
 */
export default function ReportsPage() {
  const { selectedCompanyId, selectedBranchId } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await reportsApi.list(ctx);
        if (!cancelled) setDefinitions(res.data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const more = useMemo(
    () =>
      definitions
        .filter((d) => !coveredByChecklistReports(d.key))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [definitions],
  );

  if (!ctx) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Reports</h1>
        <p className={styles.notice}>Select a company and branch to see reports.</p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Reports</h1>
          <p className={styles.subtitle}>
            Operational reports for this branch. Dates follow the branch&rsquo;s own timezone.
          </p>
        </div>
      </header>

      <nav aria-label="Reports" className={styles.reportList}>
        <ul className={listStyles.list}>
          {CHECKLIST_REPORTS.map((report) => {
            const href = reportHref(report);
            return (
              <li key={report.key}>
                {href ? (
                  <Link className={listStyles.item} href={href}>
                    <ReportRowContent icon={report.icon} title={report.title} subtitle={report.subtitle} />
                  </Link>
                ) : (
                  // Not built yet: shown, as on the dashboard, but goes nowhere.
                  <div className={listStyles.item} aria-disabled="true">
                    <ReportRowContent icon={report.icon} title={report.title} subtitle={report.subtitle} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className={styles.notice} role="status" aria-live="polite">
          Loading reports…
        </p>
      ) : null}

      {more.length > 0 ? (
        <section aria-labelledby="more-reports">
          <h2 className={styles.moreTitle} id="more-reports">
            More reports
          </h2>
          <ul className={`${listStyles.list} ${styles.reportList}`}>
            {more.map((definition) => (
              <li key={definition.key}>
                <Link className={listStyles.item} href={`/reports/${definition.key}`}>
                  <ReportRowContent icon="barChart" title={definition.name} subtitle={definition.description} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
