'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { settingsApi, type AuditEntry, type AuditEventType } from '@/lib/settings/api';
import { branchLocalToInstant } from '@/lib/queue/branch-time';
import { deviceTimeZone, formatDateTime } from '@/lib/format/datetime';
import styles from '@/components/settings/settings.module.css';

const PAGE_SIZE = 50;
const EVENT_TYPES: AuditEventType[] = ['CREATE', 'UPDATE', 'DELETE', 'SECURITY'];

function actorName(entry: AuditEntry): string {
  if (!entry.user) return 'System';
  const name = [entry.user.first_name, entry.user.last_name].filter(Boolean).join(' ');
  return name || entry.user.email;
}

/**
 * The one line an operator reads: what happened. Built from the payload's own
 * `action` and, for money and settings, the old → new values the services
 * record. Payloads are already minimised server-side (no PII, no secrets).
 */
function summarise(entry: AuditEntry): string {
  const payload = entry.payload ?? {};
  const action = typeof payload.action === 'string' ? payload.action.replace(/_/g, ' ') : '';
  const changes = payload.changes && typeof payload.changes === 'object' ? (payload.changes as Record<string, unknown>) : null;
  const parts: string[] = [];
  if (changes) {
    for (const [field, change] of Object.entries(changes)) {
      if (change && typeof change === 'object' && 'from' in change && 'to' in change) {
        const c = change as { from: unknown; to: unknown };
        parts.push(`${field.replace(/_/g, ' ')}: ${String(c.from)} → ${String(c.to)}`);
      }
    }
  }
  return [action, parts.join('; ')].filter(Boolean).join(' — ') || '—';
}

/**
 * The company's audit trail (SRS §4.4 activity log): who did what, where and
 * when. Read-only by construction — the audit table is append-only in the
 * database — and filtered and paged on the SERVER, never in the browser.
 */
export default function AuditLogPage() {
  const { selectedCompanyId, selectedBranch, companyPermissions } = useAppContext();
  const mayView = hasPermission(companyPermissions, 'audit_logs.view');
  const tz = selectedBranch?.timezone ?? deviceTimeZone();

  const [eventType, setEventType] = useState<AuditEventType | ''>('');
  const [entityType, setEntityType] = useState('');
  const [appliedEntity, setAppliedEntity] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    // Calendar days are read in the selected branch's zone, like every other
    // date filter in the app.
    const from = fromDate ? branchLocalToInstant(`${fromDate}T00:00`, tz)?.toISOString() : undefined;
    const to = toDate ? branchLocalToInstant(`${toDate}T23:59`, tz)?.toISOString() : undefined;
    return {
      limit: PAGE_SIZE,
      offset,
      ...(eventType ? { event_type: eventType } : {}),
      ...(appliedEntity ? { entity_type: appliedEntity } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }, [eventType, appliedEntity, fromDate, toDate, offset, tz]);

  useEffect(() => {
    if (!selectedCompanyId || !mayView) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await settingsApi.auditLogs(selectedCompanyId, query);
        if (cancelled) return;
        setEntries(res.data);
        setTotal(res.meta.total);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the audit log');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, mayView, query]);

  if (!selectedCompanyId) {
    return (
      <section className={styles.page}>
        <h1>Audit log</h1>
        <p className={styles.notice}>Select a company first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Audit log</h1>
        <p className={styles.notice}>You do not have access to the audit log.</p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header>
        <h1>Audit log</h1>
        <p className={styles.intro}>
          Every significant change in this company, newest first. Entries cannot be edited or removed. Times are
          shown in {tz}.
        </p>
      </header>

      <form
        className={styles.bar}
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedEntity(entityType.trim().toUpperCase());
          setOffset(0);
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-type">
            Event
          </label>
          <select
            id="audit-type"
            className={styles.select}
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value as AuditEventType | '');
              setOffset(0);
            }}
          >
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-entity">
            Record type
          </label>
          <input
            id="audit-entity"
            className={styles.input}
            placeholder="e.g. BANQUET_PAYMENT"
            maxLength={60}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-from">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            className={styles.input}
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-to">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            className={styles.input}
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={loading}>
          Apply
        </button>
      </form>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      {entries === null ? (
        error ? null : (
          <p role="status" aria-live="polite">
            Loading the audit log…
          </p>
        )
      ) : entries.length === 0 ? (
        <p className={styles.notice}>No entries match.</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">Audit log entries</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Event</th>
                  <th scope="col">Record</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.created_at, tz)}</td>
                    <td>{actorName(entry)}</td>
                    <td>{entry.branch?.name ?? 'Company'}</td>
                    <td>{entry.event_type}</td>
                    <td>{entry.entity_type}</td>
                    <td>{summarise(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span className={styles.meta}>
              Showing {offset + 1}–{offset + entries.length} of {total}
            </span>
            <button
              type="button"
              className={styles.button}
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={offset + entries.length >= total || loading}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
