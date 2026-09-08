'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor } from '@/lib/banquet/money';
import {
  BOOKING_STATUS_LABEL,
  type BanquetBooking,
  type BanquetBookingStatus,
  type BanquetHall,
  type BanquetPackage,
} from '@/lib/banquet/types';
import type { Customer } from '@/lib/queue/types';
import styles from '@/components/banquet/banquet.module.css';

const BADGE: Record<BanquetBookingStatus, string> = {
  DRAFT: styles.badgeDraft,
  CONFIRMED: styles.badgeConfirmed,
  COMPLETED: styles.badgeCompleted,
  CANCELLED: styles.badgeCancelled,
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/** `datetime-local` gives a wall-clock string; the browser zone makes it an instant. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

/**
 * Banquet bookings: the day-to-day list plus the enquiry form.
 *
 * A new booking is always a DRAFT — it holds no hall until someone confirms
 * it, which is what the detail screen is for.
 */
export default function BanquetBookingsPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions, companyPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const mayCreate = hasPermission(branchPermissions, 'banquet.booking.create');
  const mayViewCustomers = hasPermission(companyPermissions, 'customers.view');

  const [bookings, setBookings] = useState<BanquetBooking[]>([]);
  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState<BanquetBookingStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    customer_id: '',
    hall_id: '',
    package_id: '',
    starts_at: '',
    ends_at: '',
    guest_count: 50,
    notes: '',
  });

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const page = await banquetApi.listBookings(ctx, {
        limit: 100,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      setBookings(page.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [ctx, statusFilter]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect —
    // the same pattern the queue screens use.
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  // Reference data for the form, loaded once per branch.
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      const [h, p, c] = await Promise.all([
        banquetApi.listHalls(ctx).catch(() => null),
        banquetApi.listPackages(ctx).catch(() => null),
        mayViewCustomers ? banquetApi.customers(ctx).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (h) setHalls(h.data.filter((x) => x.status === 'ACTIVE'));
      if (p) setPackages(p.data.filter((x) => x.status === 'ACTIVE'));
      if (c) setCustomers(c.data.filter((x) => x.status === 'ACTIVE'));
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, mayViewCustomers]);

  const submit = async () => {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await banquetApi.createBooking(ctx, {
        customer_id: form.customer_id,
        hall_id: form.hall_id,
        package_id: form.package_id,
        starts_at: toIso(form.starts_at),
        ends_at: toIso(form.ends_at),
        guest_count: form.guest_count,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      setNotice(`Draft booking created for ${created.guest_count} guests.`);
      setShowForm(false);
      setForm({ customer_id: '', hall_id: '', package_id: '', starts_at: '', ends_at: '', guest_count: 50, notes: '' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the booking');
    } finally {
      setBusy(false);
    }
  };

  const formComplete =
    form.customer_id && form.hall_id && form.package_id && form.starts_at && form.ends_at;

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading bookings…
      </p>
    );
  }

  return (
    <>
      <h1>Banquet bookings</h1>

      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      <div className={styles.bar}>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BanquetBookingStatus | '')}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {(Object.keys(BOOKING_STATUS_LABEL) as BanquetBookingStatus[]).map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.spacer} />
        <button type="button" className={styles.action} onClick={() => void refresh()}>
          Refresh
        </button>
        {mayCreate ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            onClick={() => setShowForm((s) => !s)}
            aria-expanded={showForm}
          >
            {showForm ? 'Close' : 'New booking'}
          </button>
        ) : null}
      </div>

      {showForm && mayCreate ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="b-customer">
                Customer
              </label>
              <select
                id="b-customer"
                className={styles.select}
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
              >
                <option value="">Select…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="b-hall">
                Hall
              </label>
              <select
                id="b-hall"
                className={styles.select}
                value={form.hall_id}
                onChange={(e) => setForm({ ...form, hall_id: e.target.value })}
              >
                <option value="">Select…</option>
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} · seats {h.capacity}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="b-package">
                Package
              </label>
              <select
                id="b-package"
                className={styles.select}
                value={form.package_id}
                onChange={(e) => setForm({ ...form, package_id: e.target.value })}
              >
                <option value="">Select…</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMinor(p.price_per_guest_minor, p.currency)}/guest
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="b-start">
                Starts
              </label>
              <input
                id="b-start"
                type="datetime-local"
                className={styles.input}
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="b-end">
                Ends
              </label>
              <input
                id="b-end"
                type="datetime-local"
                className={styles.input}
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="b-guests">
                Guests
              </label>
              <input
                id="b-guests"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                className={styles.input}
                value={form.guest_count}
                onChange={(e) =>
                  setForm({
                    ...form,
                    guest_count: Math.max(1, Math.min(10000, Number.parseInt(e.target.value, 10) || 1)),
                  })
                }
              />
            </div>
          </div>

          <div>
            <label className={styles.label} htmlFor="b-notes">
              Notes (optional)
            </label>
            <textarea
              id="b-notes"
              className={styles.textarea}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <p className={styles.hint}>
            A new booking is a draft. It does not hold the hall until you confirm it.
          </p>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy || !formComplete}>
              {busy ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </form>
      ) : null}

      {bookings.length === 0 ? (
        <p className={styles.empty}>No bookings yet.</p>
      ) : (
        <ul className={styles.list}>
          {bookings.map((b) => (
            <li key={b.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.title}>
                  <Link href={`/banquet/${b.id}`} className={styles.titleLink}>
                    {b.customer?.name ?? 'Customer'}
                  </Link>
                </span>
                <span className={`${styles.badge} ${BADGE[b.status]}`}>
                  {BOOKING_STATUS_LABEL[b.status]}
                </span>
                <span className={styles.spacer} />
                <span className={styles.money}>
                  {formatMinor(b.total_amount_minor, b.currency)}
                </span>
              </div>
              <div className={styles.meta}>
                {b.hall?.name ?? 'Hall'} · {b.guest_count} guests · {when(b.starts_at)} – {when(b.ends_at)}
              </div>
              <div className={styles.meta}>{b.package_name}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
