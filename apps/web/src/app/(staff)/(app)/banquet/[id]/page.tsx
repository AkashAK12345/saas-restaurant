'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor, toMinor } from '@/lib/banquet/money';
import {
  BOOKING_STATUS_LABEL,
  KDS_STATUS_LABEL,
  type BanquetBookingDetail,
  type BanquetBookingStatus,
} from '@/lib/banquet/types';
import styles from '@/components/banquet/banquet.module.css';

const BADGE: Record<BanquetBookingStatus, string> = {
  DRAFT: styles.badgeDraft,
  CONFIRMED: styles.badgeConfirmed,
  COMPLETED: styles.badgeCompleted,
  CANCELLED: styles.badgeCancelled,
};

const when = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/** An ISO instant as the wall-clock string `datetime-local` expects. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * One booking: its lifecycle, its money and its event plan.
 *
 * Every action awaits the API and then refetches — a request is not a result,
 * and a 409 (a hall taken, a state already moved on) is shown plainly and
 * followed by a resync rather than leaving a stale screen.
 */
export default function BanquetBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params.id;
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const may = {
    confirm: hasPermission(branchPermissions, 'banquet.booking.confirm'),
    complete: hasPermission(branchPermissions, 'banquet.booking.complete'),
    cancel: hasPermission(branchPermissions, 'banquet.booking.cancel'),
    pay: hasPermission(branchPermissions, 'banquet.payment.create'),
    plan: hasPermission(branchPermissions, 'banquet.event_plan.manage'),
  };

  const [booking, setBooking] = useState<BanquetBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Two error slots on purpose. A failed ACTION is always followed by a
  // refetch, and that refetch succeeding must not erase the reason the action
  // failed — which is exactly what a single shared `error` would do.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [plan, setPlan] = useState({ service_at: '', setup_notes: '', kitchen_notes: '' });

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const next = await banquetApi.getBooking(ctx, bookingId);
      setBooking(next);
      setPlan({
        service_at: toLocalInput(next.event_plan?.service_at ?? null),
        setup_notes: next.event_plan?.setup_notes ?? '',
        kitchen_notes: next.event_plan?.kitchen_notes ?? '',
      });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the booking');
    } finally {
      setLoading(false);
    }
  }, [ctx, bookingId]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect —
    // the same pattern the queue screens use.
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  /** Run an action, then always reconcile with the server. */
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      // Reconcile in every case — but the refetch below only touches
      // loadError, so the message above survives for the operator to read.
      await refresh();
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading booking…
      </p>
    );
  }

  if (!booking) {
    return (
      <div role="alert" className={styles.error}>
        <p>{loadError ?? 'Booking not found.'}</p>
        <Link href="/banquet" className={styles.link}>
          Back to bookings
        </Link>
      </div>
    );
  }

  const b = booking;
  const payMinor = toMinor(amount, b.currency);
  const payValid = payMinor !== null && payMinor > 0 && payMinor <= b.balance.balance_minor;

  return (
    <>
      <div className={styles.bar}>
        <Link href="/banquet" className={styles.link}>
          ← Bookings
        </Link>
        <span className={styles.spacer} />
        <span className={`${styles.badge} ${BADGE[b.status]}`}>{BOOKING_STATUS_LABEL[b.status]}</span>
      </div>

      <h1>{b.customer?.name ?? 'Booking'}</h1>

      {actionError ? (
        <div role="alert" className={styles.error}>
          {actionError}
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className={styles.error}>
          {loadError}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      <div className={styles.actions} style={{ marginBottom: 'var(--gap-lg)' }}>
        {b.status === 'DRAFT' && may.confirm ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            disabled={busy}
            onClick={() =>
              void run(() => banquetApi.confirmBooking(ctx!, b.id), 'Booking confirmed — the hall is now held.')
            }
          >
            Confirm booking
          </button>
        ) : null}
        {b.status === 'CONFIRMED' && may.complete ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            disabled={busy}
            onClick={() => void run(() => banquetApi.completeBooking(ctx!, b.id), 'Event marked as completed.')}
          >
            Mark completed
          </button>
        ) : null}
        {(b.status === 'DRAFT' || b.status === 'CONFIRMED') && may.cancel ? (
          <button
            type="button"
            className={`${styles.action} ${styles.danger}`}
            disabled={busy}
            onClick={() => void run(() => banquetApi.cancelBooking(ctx!, b.id), 'Booking cancelled.')}
          >
            Cancel booking
          </button>
        ) : null}
      </div>

      <div className={styles.columns}>
        <div>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Event</h2>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Hall</span>
                <span>{b.hall?.name ?? '—'}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Starts</span>
                <span>{when(b.starts_at)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Ends</span>
                <span>{when(b.ends_at)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Guests</span>
                <span>{b.guest_count}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Package</span>
                <span>
                  {b.package_name} · {formatMinor(b.price_per_guest_minor, b.currency)}/guest
                </span>
              </div>
              {b.notes ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Notes</span>
                  <span>{b.notes}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Menu</h2>
            {b.items.length === 0 ? (
              <p className={styles.empty}>This package has no components.</p>
            ) : (
              <ul className={styles.items}>
                {b.items.map((i) => (
                  <li key={i.id} className={styles.item}>
                    <span className={styles.itemName}>{i.name}</span>
                    <span className={styles.badge}>{KDS_STATUS_LABEL[i.kds_status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Event plan</h2>
            {may.plan && b.status !== 'CANCELLED' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      banquetApi.saveEventPlan(ctx!, b.id, {
                        service_at: plan.service_at ? new Date(plan.service_at).toISOString() : null,
                        setup_notes: plan.setup_notes.trim() || null,
                        kitchen_notes: plan.kitchen_notes.trim() || null,
                      }),
                    'Event plan saved — the kitchen has been notified.',
                  );
                }}
              >
                <div className={styles.grid}>
                  <div>
                    <label className={styles.label} htmlFor="p-service">
                      Service time
                    </label>
                    <input
                      id="p-service"
                      type="datetime-local"
                      className={styles.input}
                      value={plan.service_at}
                      onChange={(e) => setPlan({ ...plan, service_at: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="p-setup">
                      Setup notes
                    </label>
                    <textarea
                      id="p-setup"
                      className={styles.textarea}
                      value={plan.setup_notes}
                      onChange={(e) => setPlan({ ...plan, setup_notes: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="p-kitchen">
                      Kitchen notes
                    </label>
                    <textarea
                      id="p-kitchen"
                      className={styles.textarea}
                      value={plan.kitchen_notes}
                      onChange={(e) => setPlan({ ...plan, kitchen_notes: e.target.value })}
                    />
                    <p className={styles.hint}>Shown on the chef display.</p>
                  </div>
                </div>
                <div className={styles.actions} style={{ marginTop: 'var(--gap)' }}>
                  <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy}>
                    Save plan
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.rows}>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Service time</span>
                  <span>{when(b.event_plan?.service_at ?? null)}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Setup</span>
                  <span>{b.event_plan?.setup_notes ?? '—'}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Kitchen</span>
                  <span>{b.event_plan?.kitchen_notes ?? '—'}</span>
                </div>
              </div>
            )}
          </section>
        </div>

        <div>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Advance &amp; balance</h2>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Total</span>
                <span className={styles.money}>
                  {formatMinor(b.balance.total_amount_minor, b.balance.currency)}
                </span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Paid</span>
                <span className={`${styles.money} ${styles.paid}`}>
                  {formatMinor(b.balance.paid_minor, b.balance.currency)}
                </span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Balance due</span>
                <span
                  className={`${styles.balanceTotal} ${b.balance.fully_paid ? styles.paid : styles.due}`}
                >
                  {formatMinor(b.balance.balance_minor, b.balance.currency)}
                </span>
              </div>
            </div>

            {may.pay && !b.balance.fully_paid && b.status !== 'CANCELLED' ? (
              <form
                style={{ marginTop: 'var(--gap)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (payMinor === null) return;
                  void run(async () => {
                    await banquetApi.createPayment(ctx!, b.id, {
                      amount_minor: payMinor,
                      currency: b.currency,
                      ...(method.trim() ? { method: method.trim() } : {}),
                    });
                    setAmount('');
                    setMethod('');
                  }, 'Payment recorded.');
                }}
              >
                <div className={`${styles.grid} ${styles.grid2}`}>
                  <div>
                    <label className={styles.label} htmlFor="pay-amount">
                      Amount ({b.currency})
                    </label>
                    <input
                      id="pay-amount"
                      className={styles.input}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="pay-method">
                      Method (optional)
                    </label>
                    <input
                      id="pay-method"
                      className={styles.input}
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    />
                  </div>
                </div>
                {amount && payMinor === null ? (
                  <p className={styles.hint}>Enter a plain amount, e.g. 25000.00</p>
                ) : null}
                {payMinor !== null && payMinor > b.balance.balance_minor ? (
                  <p className={styles.hint}>That is more than the outstanding balance.</p>
                ) : null}
                <div className={styles.actions} style={{ marginTop: 'var(--gap)' }}>
                  <button
                    type="submit"
                    className={`${styles.action} ${styles.primary}`}
                    disabled={busy || !payValid}
                  >
                    Record payment
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Payment history</h2>
            {b.payments.length === 0 ? (
              <p className={styles.empty}>No payments recorded.</p>
            ) : (
              <ul className={styles.items}>
                {b.payments.map((p) => (
                  <li key={p.id} className={styles.item}>
                    <span className={styles.itemName}>
                      {when(p.paid_at)}
                      {p.method ? ` · ${p.method}` : ''}
                    </span>
                    <span className={styles.money}>{formatMinor(p.amount_minor, p.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.hint}>Payments are a permanent record and cannot be edited.</p>
          </section>
        </div>
      </div>
    </>
  );
}
