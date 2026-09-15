'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { adminApi, type TableRecord } from '@/lib/admin/api';
import { queueApi } from '@/lib/queue/api';
import type { QueueTableAvailability } from '@/lib/queue/types';
import styles from '@/components/settings/settings.module.css';

const PAGE_SIZE = 100;

interface Form {
  label: string;
  capacity: string;
  zone: string;
}

const EMPTY: Form = { label: '', capacity: '4', zone: '' };

/**
 * The selected branch's tables: label, seats, zone and whether the table is in
 * service — plus, for anyone who may see the queue, who is sitting at it now.
 *
 * Occupancy comes from the queue (a seated party), never from a status someone
 * sets by hand, so this screen cannot drift from the podium. A table with a
 * seated party cannot be taken out of service; the API refuses and says why.
 */
export default function TablesPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const mayView = hasPermission(branchPermissions, 'tables.view');
  const mayCreate = hasPermission(branchPermissions, 'tables.create');
  const mayUpdate = hasPermission(branchPermissions, 'tables.update');
  const maySeeQueue = hasPermission(branchPermissions, 'queue.view');

  const [tables, setTables] = useState<{ data: TableRecord[]; total: number } | null>(null);
  const [occupancy, setOccupancy] = useState<Map<string, QueueTableAvailability['occupied_by']>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCompanyId || !selectedBranchId) return;
    try {
      const res = await adminApi.tables(selectedCompanyId, selectedBranchId, { limit: PAGE_SIZE, offset: 0 });
      setTables({ data: res.data, total: res.meta.total });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tables');
      return;
    }
    if (maySeeQueue) {
      try {
        const rows = await queueApi.tableAvailability({ companyId: selectedCompanyId, branchId: selectedBranchId });
        setOccupancy(new Map((rows ?? []).map((r) => [r.id, r.occupied_by])));
      } catch {
        // Occupancy is a convenience on this screen; the table list stands alone.
        setOccupancy(new Map());
      }
    }
  }, [selectedCompanyId, selectedBranchId, maySeeQueue]);

  useEffect(() => {
    if (!mayView) return;
    void (async () => {
      await load();
    })();
  }, [load, mayView]);

  if (!selectedCompanyId || !selectedBranchId) {
    return (
      <section className={styles.page}>
        <h1>Tables</h1>
        <p className={styles.notice}>Select a branch first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Tables</h1>
        <p className={styles.notice}>You do not have access to tables at this branch.</p>
      </section>
    );
  }

  const capacity = Number(form.capacity);
  const formValid = form.label.trim() !== '' && Number.isInteger(capacity) && capacity >= 1 && capacity <= 500;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (editing === 'new') {
        const created = await adminApi.createTable(selectedCompanyId, selectedBranchId, {
          label: form.label.trim(),
          capacity,
          ...(form.zone.trim() ? { zone: form.zone.trim() } : {}),
        });
        setNotice(`Added table ${created.label}.`);
      } else if (editing) {
        const updated = await adminApi.updateTable(selectedCompanyId, selectedBranchId, editing, {
          label: form.label.trim(),
          capacity,
          zone: form.zone.trim() ? form.zone.trim() : null,
        });
        setNotice(`Saved table ${updated.label}.`);
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the table');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (table: TableRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = table.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await adminApi.updateTable(selectedCompanyId, selectedBranchId, table.id, { status: next });
      setNotice(`Table ${table.label} is now ${next === 'ACTIVE' ? 'in service' : 'out of service'}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the table');
    } finally {
      setBusy(false);
    }
  };

  const seats = tables?.data.filter((t) => t.status === 'ACTIVE').reduce((sum, t) => sum + t.capacity, 0) ?? 0;

  const editor = (key: string) => (
    <form
      className={styles.bar}
      onSubmit={(e) => {
        e.preventDefault();
        if (formValid) void save();
      }}
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`label-${key}`}>
          Label
        </label>
        <input
          id={`label-${key}`}
          className={styles.input}
          required
          maxLength={50}
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`capacity-${key}`}>
          Seats
        </label>
        <input
          id={`capacity-${key}`}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          required
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`zone-${key}`}>
          Zone (optional)
        </label>
        <input
          id={`zone-${key}`}
          className={styles.input}
          maxLength={100}
          value={form.zone}
          onChange={(e) => setForm({ ...form, zone: e.target.value })}
        />
      </div>
      <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !formValid}>
        {key === 'new' ? 'Add table' : 'Save'}
      </button>
      <button type="button" className={styles.button} onClick={() => setEditing(null)}>
        Cancel
      </button>
    </form>
  );

  return (
    <section className={styles.page}>
      <header>
        <h1>Tables</h1>
        <p className={styles.intro}>
          Tables at {selectedBranch?.name ?? 'this branch'}
          {tables ? ` — ${tables.total} tables, ${seats} seats in service.` : '.'}
        </p>
      </header>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {mayCreate ? (
        editing === 'new' ? (
          <div className={styles.card}>{editor('new')}</div>
        ) : (
          <div className={styles.bar}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy}
              onClick={() => {
                setForm(EMPTY);
                setEditing('new');
                setNotice(null);
              }}
            >
              Add table
            </button>
          </div>
        )
      ) : null}

      {tables === null ? (
        error ? null : (
          <p role="status" aria-live="polite">
            Loading tables…
          </p>
        )
      ) : tables.data.length === 0 ? (
        <p className={styles.notice}>This branch has no tables yet.</p>
      ) : (
        <ul className={styles.list} aria-label="Tables">
          {tables.data.map((t) => {
            const occupiedBy = occupancy.get(t.id) ?? null;
            return (
              <li key={t.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.title}>{t.label}</span>
                  <span className={styles.badge}>{t.status === 'ACTIVE' ? 'In service' : 'Out of service'}</span>
                  {maySeeQueue ? (
                    <span className={styles.badge}>
                      {occupiedBy ? `Occupied — token ${occupiedBy.token_number}` : 'Free'}
                    </span>
                  ) : null}
                  <span className={styles.meta}>
                    {t.capacity} {t.capacity === 1 ? 'seat' : 'seats'}
                    {t.zone ? ` · ${t.zone}` : ''}
                  </span>
                  <span className={styles.spacer} />
                  {mayUpdate && editing !== t.id ? (
                    <>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={busy}
                        aria-label={`Edit table ${t.label}`}
                        onClick={() => {
                          setForm({ label: t.label, capacity: String(t.capacity), zone: t.zone ?? '' });
                          setEditing(t.id);
                          setNotice(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={busy}
                        aria-label={`${t.status === 'ACTIVE' ? 'Take out of service' : 'Return to service'} table ${t.label}`}
                        onClick={() => void toggleStatus(t)}
                      >
                        {t.status === 'ACTIVE' ? 'Take out of service' : 'Return to service'}
                      </button>
                    </>
                  ) : null}
                </div>
                {editing === t.id ? editor(t.id) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
