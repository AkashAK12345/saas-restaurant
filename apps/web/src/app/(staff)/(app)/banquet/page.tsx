'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi, type BookingTab, type PaymentFilter } from '@/lib/banquet/api';
import { formatMinor } from '@/lib/banquet/money';
import { branchLocalToInstant } from '@/lib/queue/branch-time';
import { addCalendarDays, deviceTimeZone, formatDateTime } from '@/lib/format/datetime';
import {
  BOOKING_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type BanquetBooking,
  type BanquetBookingStatus,
  type BanquetHall,
  type BanquetPackage,
  type BanquetPaymentStatus,
} from '@/lib/banquet/types';
import type { Customer } from '@/lib/queue/types';
import styles from '@/components/banquet/banquet.module.css';

const BADGE: Record<BanquetBookingStatus, string> = {
  DRAFT: styles.badgeDraft,
  CONFIRMED: styles.badgeConfirmed,
  COMPLETED: styles.badgeCompleted,
  CANCELLED: styles.badgeCancelled,
};

const PAYMENT_BADGE: Record<BanquetPaymentStatus, string> = {
  UNPAID: styles.badgeUnpaid,
  PARTIAL: styles.badgePartial,
  PAID: styles.badgePaid,
};

const TABS: Array<{ key: BookingTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAYMENT_FILTERS: Array<{ key: PaymentFilter | ''; label: string }> = [
  { key: '', label: 'Any payment state' },
  { key: 'pending', label: 'Payment pending' },
  { key: 'paid', label: 'Fully paid' },
  { key: 'unverified', label: 'Has unverified payments' },
];

const EMPTY_FORM = {
  customer_id: '',
  hall_id: '',
  package_id: '',
  starts_at: '',
  ends_at: '',
  guest_count: 50,
  extra_pax: 0,
  apply_gst: true,
  notes: '',
};

/**
 * Banquet bookings: the day-to-day list plus the enquiry form.
 *
 * A new booking is always created as a DRAFT — it holds no hall until someone
 * confirms it. Someone who may also confirm can do both in one step: the
 * booking is created, then confirmed through the same explicit operation the
 * detail screen uses, so the server still checks the hall is free.
 *
 * Times are entered and shown in the BRANCH's timezone, whatever the device's.
 */
export default function BanquetBookingsPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions, companyPermissions } =
    useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const mayCreate = hasPermission(branchPermissions, 'banquet.booking.create');
  const mayConfirm = hasPermission(branchPermissions, 'banquet.booking.confirm');
  const mayViewCustomers = hasPermission(companyPermissions, 'customers.view');

  const [bookings, setBookings] = useState<BanquetBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tab, setTab] = useState<BookingTab>('all');
  const [payment, setPayment] = useState<PaymentFilter | ''>('');
  const [hallFilter, setHallFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  // The empty state is a claim that there is nothing to show; it may only be
  // made once a list has actually loaded, never after a refused or failed load.
  const [listed, setListed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which submit is in flight, so each button can say what it is doing.
  const [busy, setBusy] = useState<'draft' | 'confirm' | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const page = await banquetApi.listBookings(ctx, {
        limit: 100,
        ...(tab !== 'all' ? { tab } : {}),
        ...(payment ? { payment } : {}),
        ...(hallFilter ? { hall_id: hallFilter } : {}),
        ...(query ? { q: query } : {}),
      });
      setBookings(page.data);
      setTotal(page.meta.total);
      setListed(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [ctx, tab, payment, hallFilter, query]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect —
    // the same pattern the queue screens use.
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  // Reference data for the form and the hall filter, loaded once per branch.
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

  const selectedHall = halls.find((h) => h.id === form.hall_id) ?? null;
  const hallSlots = (selectedHall?.slots ?? []).filter((s) => s.status === 'ACTIVE');

  /** Fill the start and end from a hall slot on the date already chosen. */
  const applySlot = (slotId: string) => {
    const slot = hallSlots.find((s) => s.id === slotId);
    const date = form.starts_at.slice(0, 10);
    if (!slot || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const endDate = slot.end_time > slot.start_time ? date : addCalendarDays(date, 1);
    setForm({ ...form, starts_at: `${date}T${slot.start_time}`, ends_at: `${endDate}T${slot.end_time}` });
  };

  const submit = async (confirm: boolean) => {
    if (!ctx) return;
    const startsAt = branchLocalToInstant(form.starts_at, tz);
    const endsAt = branchLocalToInstant(form.ends_at, tz);
    if (!startsAt || !endsAt) {
      setError('Enter a valid start and end time.');
      return;
    }
    setBusy(confirm ? 'confirm' : 'draft');
    setError(null);
    setNotice(null);
    try {
      const created = await banquetApi.createBooking(ctx, {
        customer_id: form.customer_id,
        hall_id: form.hall_id,
        package_id: form.package_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        guest_count: form.guest_count,
        ...(form.extra_pax > 0 ? { extra_pax: form.extra_pax } : {}),
        ...(form.apply_gst ? {} : { apply_gst: false }),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      // The booking exists from here on, whatever happens to the confirmation.
      setShowForm(false);
      setForm(EMPTY_FORM);

      let confirmError: string | null = null;
      if (!confirm) {
        setNotice(`Draft booking created for ${created.guest_count} guests.`);
      } else {
        try {
          await banquetApi.confirmBooking(ctx, created.id);
          setNotice(`Booking confirmed for ${created.guest_count} guests — the hall is now held.`);
        } catch (e) {
          // Typically the hall is already taken for that time. The draft is
          // kept, so nothing typed is lost; it can be changed and confirmed
          // from its own page.
          const reason = e instanceof Error ? e.message : 'the confirmation failed';
          confirmError = `The booking was saved as a draft but could not be confirmed: ${reason}`;
        }
      }
      await refresh();
      // After the refresh, which clears the error once the list loads.
      if (confirmError) setError(confirmError);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the booking');
    } finally {
      setBusy(null);
    }
  };

  const formComplete =
    form.customer_id && form.hall_id && form.package_id && form.starts_at && form.ends_at;
  const filtered = tab !== 'all' || payment !== '' || hallFilter !== '' || query !== '';

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
        <div className={styles.tabs} role="group" aria-label="Booking view">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.action} ${tab === t.key ? styles.tabOn : ''}`}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
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

      <div className={styles.bar}>
        <select
          className={styles.select}
          style={{ width: 'auto' }}
          value={payment}
          onChange={(e) => setPayment(e.target.value as PaymentFilter | '')}
          aria-label="Filter by payment"
        >
          {PAYMENT_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          style={{ width: 'auto' }}
          value={hallFilter}
          onChange={(e) => setHallFilter(e.target.value)}
          aria-label="Filter by hall"
        >
          <option value="">All halls</option>
          {halls.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <form
          className={styles.search}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <input
            className={styles.input}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, package or hall"
            aria-label="Search bookings"
            maxLength={100}
          />
          <button type="submit" className={styles.action}>
            Search
          </button>
        </form>
      </div>

      {showForm && mayCreate ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
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
                    {p.name} · {formatMinor(p.price_per_guest_minor, p.currency, 'en-IN')}/guest
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
            {hallSlots.length > 0 ? (
              <div>
                <label className={styles.label} htmlFor="b-slot">
                  Use a hall slot
                </label>
                <select
                  id="b-slot"
                  className={styles.select}
                  value=""
                  disabled={!/^\d{4}-\d{2}-\d{2}/.test(form.starts_at)}
                  onChange={(e) => applySlot(e.target.value)}
                >
                  <option value="">Select…</option>
                  {hallSlots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.start_time}–{s.end_time}
                    </option>
                  ))}
                </select>
                <p className={styles.hint}>Pick the date in Starts first.</p>
              </div>
            ) : null}
          </div>

          <div className={`${styles.grid} ${styles.grid3}`}>
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
              <p className={styles.hint}>The guaranteed head count.</p>
            </div>
            <div>
              <label className={styles.label} htmlFor="b-extra">
                Extra pax
              </label>
              <input
                id="b-extra"
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                className={styles.input}
                value={form.extra_pax}
                onChange={(e) =>
                  setForm({
                    ...form,
                    extra_pax: Math.max(0, Math.min(10000, Number.parseInt(e.target.value, 10) || 0)),
                  })
                }
              />
              <p className={styles.hint}>Guests over the guarantee, at the same rate.</p>
            </div>
            <div>
              <span className={styles.label}>GST</span>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={form.apply_gst}
                  onChange={(e) => setForm({ ...form, apply_gst: e.target.checked })}
                />
                Apply the branch GST rate
              </label>
              <p className={styles.hint}>Untick for a no-GST booking. The rate is the branch setting.</p>
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
            Times are in the branch&rsquo;s timezone ({tz}).{' '}
            {mayConfirm
              ? 'A draft does not hold the hall. Create & confirm also holds the hall, if it is free at that time.'
              : 'A new booking is a draft. It does not hold the hall until you confirm it.'}
          </p>
          <div className={styles.actions}>
            <button
              type="submit"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy !== null || !formComplete}
            >
              {busy === 'draft' ? 'Creating…' : 'Create draft'}
            </button>
            {mayConfirm ? (
              <button
                type="button"
                className={`${styles.action} ${styles.primary}`}
                disabled={busy !== null || !formComplete}
                onClick={() => void submit(true)}
              >
                {busy === 'confirm' ? 'Confirming…' : 'Create & confirm'}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {!listed ? null : bookings.length === 0 ? (
        <p className={styles.empty}>{filtered ? 'No bookings match these filters.' : 'No bookings yet.'}</p>
      ) : (
        <>
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
                  {b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? (
                    <span className={`${styles.badge} ${PAYMENT_BADGE[b.payment_status]}`}>
                      {PAYMENT_STATUS_LABEL[b.payment_status]}
                    </span>
                  ) : null}
                  <span className={styles.spacer} />
                  <span className={styles.money}>
                    {formatMinor(b.total_amount_minor, b.currency, 'en-IN')}
                  </span>
                </div>
                <div className={styles.meta}>
                  {b.hall_name} · {b.guest_count}
                  {b.extra_pax > 0 ? ` + ${b.extra_pax}` : ''} guests · {formatDateTime(b.starts_at, tz)} –{' '}
                  {formatDateTime(b.ends_at, tz)}
                </div>
                <div className={styles.meta}>{b.package_name}</div>
              </li>
            ))}
          </ul>
          {total > bookings.length ? (
            <p className={styles.hint}>
              Showing the first {bookings.length} of {total}. Narrow the filters to find the rest.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
