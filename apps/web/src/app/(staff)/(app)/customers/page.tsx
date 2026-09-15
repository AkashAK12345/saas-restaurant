'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { adminApi, type ActiveStatus, type CustomerRecord } from '@/lib/admin/api';
import { formatDateTime } from '@/lib/format/datetime';
import styles from '@/components/settings/settings.module.css';
import admin from '@/components/admin/admin.module.css';

const PAGE_SIZE = 25;

/** Only the last four digits in the list; the full number in the details panel. */
function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  return phone.length <= 4 ? phone : `••••${phone.slice(-4)}`;
}

interface Form {
  name: string;
  phone: string;
}

/**
 * Company customers: search by name or phone, filter by status, page through,
 * open one for details, and — with the matching permission — add or edit.
 *
 * The list masks phone numbers; the details panel, opened deliberately for one
 * customer, shows the number the staff member needs to call.
 */
export default function CustomersPage() {
  const { selectedCompanyId, companyPermissions } = useAppContext();
  const mayView = hasPermission(companyPermissions, 'customers.view');
  const mayCreate = hasPermission(companyPermissions, 'customers.create');
  const mayUpdate = hasPermission(companyPermissions, 'customers.update');

  const [query, setQuery] = useState<{ q: string; status: '' | ActiveStatus; offset: number }>({
    q: '',
    status: '',
    offset: 0,
  });
  const [draftQ, setDraftQ] = useState('');
  const [page, setPage] = useState<{ data: CustomerRecord[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerRecord | null>(null);
  const [mode, setMode] = useState<'none' | 'create' | 'edit'>('none');
  const [form, setForm] = useState<Form>({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const res = await adminApi.customers(selectedCompanyId, {
        q: query.q || undefined,
        status: query.status || undefined,
        limit: PAGE_SIZE,
        offset: query.offset,
      });
      setPage({ data: res.data, total: res.meta.total });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load customers');
    }
  }, [selectedCompanyId, query]);

  useEffect(() => {
    if (!mayView) return;
    void (async () => {
      await load();
    })();
  }, [load, mayView]);

  if (!selectedCompanyId) {
    return (
      <section className={styles.page}>
        <h1>Customers</h1>
        <p className={styles.notice}>Select a company first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Customers</h1>
        <p className={styles.notice}>You do not have access to customers.</p>
      </section>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'create') {
        const created = await adminApi.createCustomer(selectedCompanyId, {
          name: form.name.trim(),
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        });
        setSelected(created);
        setNotice(`Added ${created.name}.`);
      } else if (mode === 'edit' && selected) {
        const updated = await adminApi.updateCustomer(selectedCompanyId, selected.id, {
          name: form.name.trim(),
          phone: form.phone.trim() ? form.phone.trim() : null,
        });
        setSelected(updated);
        setNotice(`Saved ${updated.name}.`);
      }
      setMode('none');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the customer');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (customer: CustomerRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next: ActiveStatus = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const updated = await adminApi.updateCustomer(selectedCompanyId, customer.id, { status: next });
      setSelected(updated);
      setNotice(`${updated.name} is now ${next === 'ACTIVE' ? 'active' : 'inactive'}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the status');
    } finally {
      setBusy(false);
    }
  };

  const from = page && page.total > 0 ? query.offset + 1 : 0;
  const to = page ? query.offset + page.data.length : 0;

  return (
    <section className={styles.page}>
      <header>
        <h1>Customers</h1>
        <p className={styles.intro}>Everyone this company has served in the queue or booked for a banquet.</p>
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

      <form
        className={styles.bar}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ ...query, q: draftQ.trim(), offset: 0 });
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="customer-search">
            Search name or phone
          </label>
          <input
            id="customer-search"
            className={styles.input}
            maxLength={100}
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="customer-status">
            Status
          </label>
          <select
            id="customer-status"
            className={styles.select}
            value={query.status}
            onChange={(e) => setQuery({ ...query, status: e.target.value as '' | ActiveStatus, offset: 0 })}
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <button type="submit" className={styles.button}>
          Search
        </button>
        <span className={styles.spacer} />
        {mayCreate ? (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => {
              setForm({ name: '', phone: '' });
              setMode('create');
              setNotice(null);
            }}
          >
            Add customer
          </button>
        ) : null}
      </form>

      <div className={admin.split}>
        <div>
          {page === null ? (
            error ? null : (
              <p role="status" aria-live="polite">
                Loading customers…
              </p>
            )
          ) : page.data.length === 0 ? (
            <p className={styles.notice}>
              {query.q || query.status ? 'No customers match this search.' : 'No customers yet.'}
            </p>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table} aria-label="Customers">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Status</th>
                      <th scope="col">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.data.map((c) => (
                      <tr key={c.id} aria-selected={selected?.id === c.id}>
                        <td>
                          <button
                            type="button"
                            className={admin.rowButton}
                            onClick={() => {
                              setSelected(c);
                              setMode('none');
                            }}
                          >
                            {c.name}
                          </button>
                        </td>
                        <td>{maskPhone(c.phone)}</td>
                        <td>{c.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
                        <td>{formatDateTime(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <span>
                  Showing {from}–{to} of {page.total}
                </span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={query.offset === 0}
                  onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - PAGE_SIZE) })}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={to >= page.total}
                  onClick={() => setQuery({ ...query, offset: query.offset + PAGE_SIZE })}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>

        <aside aria-label="Customer details">
          {mode !== 'none' ? (
            <form
              className={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name.trim()) void submit();
              }}
            >
              <h2 className={styles.title}>{mode === 'create' ? 'New customer' : `Edit ${selected?.name ?? ''}`}</h2>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="customer-name">
                  Name
                </label>
                <input
                  id="customer-name"
                  className={styles.input}
                  required
                  maxLength={200}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="customer-phone">
                  Phone (optional)
                </label>
                <input
                  id="customer-phone"
                  className={styles.input}
                  type="tel"
                  inputMode="tel"
                  maxLength={32}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className={styles.bar}>
                <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !form.name.trim()}>
                  {mode === 'create' ? 'Add' : 'Save'}
                </button>
                <button type="button" className={styles.button} onClick={() => setMode('none')}>
                  Cancel
                </button>
              </div>
            </form>
          ) : selected ? (
            <div className={styles.card}>
              <h2 className={styles.title}>{selected.name}</h2>
              <dl className={admin.details}>
                <dt>Phone</dt>
                <dd>{selected.phone ?? 'Not recorded'}</dd>
                <dt>Status</dt>
                <dd>{selected.status === 'ACTIVE' ? 'Active' : 'Inactive'}</dd>
                <dt>Added</dt>
                <dd>{formatDateTime(selected.created_at)}</dd>
                <dt>Last changed</dt>
                <dd>{formatDateTime(selected.updated_at)}</dd>
              </dl>
              {mayUpdate ? (
                <div className={styles.bar}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => {
                      setForm({ name: selected.name, phone: selected.phone ?? '' });
                      setMode('edit');
                      setNotice(null);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className={styles.button} disabled={busy} onClick={() => void toggleStatus(selected)}>
                    {selected.status === 'ACTIVE' ? 'Mark inactive' : 'Mark active'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className={styles.meta}>Choose a customer to see their details.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
