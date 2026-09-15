'use client';

import { useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { settingsApi, type AuditEntry } from '@/lib/settings/api';
import { actorName, summarise } from '@/lib/settings/audit-format';
import { deviceTimeZone, formatDateTime } from '@/lib/format/datetime';
import styles from '@/components/settings/settings.module.css';

const LIMIT = 50;

/**
 * The audit trail of ONE record (SRS §4.4 per-record audit information): who
 * changed it, when, and what changed — read from the same append-only audit log
 * the company audit page shows, filtered on the server by record type and id.
 *
 * Offered only to holders of audit_logs.view, and fetched only when opened, so
 * a detail page costs nothing extra for anyone who does not look.
 */
export function RecordHistory({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { selectedCompanyId, selectedBranch, companyPermissions } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!selectedCompanyId || !hasPermission(companyPermissions, 'audit_logs.view')) return null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await settingsApi.auditLogs(selectedCompanyId, {
        entity_type: entityType,
        entity_id: entityId,
        limit: LIMIT,
        offset: 0,
      });
      setEntries(res.data);
      setTotal(res.meta.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the history');
    } finally {
      setLoading(false);
    }
  };

  return (
    <details
      className={styles.card}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && entries === null && !loading) void load();
      }}
    >
      <summary className={styles.title}>History</summary>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" aria-live="polite">
          Loading the history…
        </p>
      ) : entries === null ? null : entries.length === 0 ? (
        <p className={styles.meta}>No recorded changes.</p>
      ) : (
        <>
          <ol className={styles.list} aria-label="Change history">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className={styles.meta}>
                  {formatDateTime(entry.created_at, tz)} · {actorName(entry)} · {entry.event_type}
                </span>
                <br />
                {summarise(entry)}
              </li>
            ))}
          </ol>
          {total > entries.length ? (
            <p className={styles.meta}>
              Showing the latest {entries.length} of {total}. The full trail is in the audit log.
            </p>
          ) : null}
        </>
      )}
    </details>
  );
}
