'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { reportsApi } from '@/lib/reports/api';
import type { ReportDefinition } from '@/lib/reports/types';
import styles from '@/components/reports/reports.module.css';

/**
 * The report catalogue.
 *
 * The list comes from the SERVER, already filtered to the reports this user
 * may actually run — the page never enumerates a menu of reports it would then
 * refuse. Grouping is by the domain each report declares, so a report from a
 * future module appears under its own heading with no change here.
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

  const byDomain = useMemo(() => {
    const groups = new Map<string, ReportDefinition[]>();
    for (const definition of definitions) {
      const list = groups.get(definition.domain) ?? [];
      list.push(definition);
      groups.set(definition.domain, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [definitions]);

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

      {!loading && definitions.length === 0 && !error ? (
        <p className={styles.notice}>
          No reports are available to you at this branch.
        </p>
      ) : null}

      {byDomain.map(([domain, group]) => (
        <section key={domain}>
          <h2 className={styles.title}>{domain.charAt(0).toUpperCase() + domain.slice(1)}</h2>
          <ul className={styles.cards}>
            {group.map((definition) => (
              <li key={definition.key} className={styles.card}>
                <Link className={styles.cardTitle} href={`/reports/${definition.key}`}>
                  {definition.name}
                </Link>
                <p className={styles.subtitle}>{definition.description}</p>
                <span className={styles.domain}>{definition.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
