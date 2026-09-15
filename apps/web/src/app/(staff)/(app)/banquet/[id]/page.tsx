'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor, toMinor } from '@/lib/banquet/money';
import { branchLocalToInstant, instantToBranchLocal } from '@/lib/queue/branch-time';
import { useNow } from '@/lib/queue/use-now';
import { deviceTimeZone, formatDateTime } from '@/lib/format/datetime';
import {
  ADJUSTMENT_LABEL,
  ADJUSTMENT_PERMISSION,
  BOOKING_STATUS_LABEL,
  KDS_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_STATUS_LABEL,
  PLATE_STATUS_LABEL,
  type PlateRequest,
  type BanquetAdjustmentKind,
  type BanquetBookingDetail,
  type BanquetBookingStatus,
  type BanquetHall,
  type BanquetPaymentStatus,
} from '@/lib/banquet/types';
import styles from '@/components/banquet/banquet.module.css';
import { RecordHistory } from '@/components/audit/record-history';

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

const KINDS = Object.keys(ADJUSTMENT_LABEL) as BanquetAdjustmentKind[];
const isDiscount = (kind: BanquetAdjustmentKind) => kind !== 'EXTRA_CHARGE';
/** Basis points as a percentage label. Display only — never money. */
const percent = (bps: number) => `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

interface EditForm {
  hall_id: string;
  starts_at: string;
  ends_at: string;
  guest_count: number;
  extra_pax: number;
  apply_gst: boolean;
  notes: string;
}

/**
 * One booking: its lifecycle, its bill, its payments and its event plan.
 *
 * Every action awaits the API and then refetches — a request is not a result,
 * and a 409 (a hall taken, a state already moved on, a discount larger than
 * the bill) or a 403 (an event that has already started) is shown plainly and
 * followed by a resync rather than leaving a stale screen. The buttons shown
 * follow the viewer's permissions as a courtesy; the API decides.
 */
export default function BanquetBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params.id;
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const { user } = useAuth();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const now = useNow(60_000);
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const can = (key: string) => hasPermission(branchPermissions, key);
  const may = {
    update: can('banquet.booking.update'),
    editPast: can('banquet.booking.edit_past'),
    confirm: can('banquet.booking.confirm'),
    complete: can('banquet.booking.complete'),
    cancel: can('banquet.booking.cancel'),
    pay: can('banquet.payment.create'),
    verify: can('banquet.payment.verify'),
    plan: can('banquet.event_plan.manage'),
    requestPlates: can('banquet.plate.request'),
  };
  const permittedKinds = KINDS.filter((k) => can(ADJUSTMENT_PERMISSION[k]));

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
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [line, setLine] = useState<{ kind: BanquetAdjustmentKind | ''; description: string; amount: string }>({
    kind: '',
    description: '',
    amount: '',
  });

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const next = await banquetApi.getBooking(ctx, bookingId);
      setBooking(next);
      setPlan({
        service_at: next.event_plan?.service_at ? instantToBranchLocal(new Date(next.event_plan.service_at), tz) : '',
        setup_notes: next.event_plan?.setup_notes ?? '',
        kitchen_notes: next.event_plan?.kitchen_notes ?? '',
      });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the booking');
    } finally {
      setLoading(false);
    }
  }, [ctx, bookingId, tz]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect —
    // the same pattern the queue screens use.
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  // Plate requests: re-read when the booking reloads or a request is sent.
  const [plateRequests, setPlateRequests] = useState<PlateRequest[] | null>(null);
  const [platesError, setPlatesError] = useState<string | null>(null);
  const [plateForm, setPlateForm] = useState({ item_id: '', plates: '', note: '' });
  const [platesNonce, setPlatesNonce] = useState(0);
  const bookingUpdatedAt = booking?.updated_at;
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await banquetApi.bookingPlateRequests(ctx, bookingId);
        if (!cancelled) {
          setPlateRequests(rows ?? []);
          setPlatesError(null);
        }
      } catch (e) {
        if (!cancelled) setPlatesError(e instanceof Error ? e.message : 'Could not load plate requests');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, bookingId, bookingUpdatedAt, platesNonce]);

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
  const money = (minor: number) => formatMinor(minor, b.currency, 'en-IN');
  const live = b.status === 'DRAFT' || b.status === 'CONFIRMED';
  const started = new Date(b.starts_at).getTime() <= now;
  const alterable = live && (!started || may.editPast);
  const payMinor = toMinor(amount, b.currency);
  const payValid = payMinor !== null && payMinor > 0 && payMinor <= b.balance.balance_minor;
  const lineMinor = line.kind ? toMinor(line.amount, b.currency) : null;
  const lineValid = line.kind !== '' && line.description.trim() !== '' && lineMinor !== null && lineMinor > 0;
  const inv = b.invoice;
  // Whole plates, 1–10,000: the API's rule, checked here only to explain it.
  const platesCount = Number(plateForm.plates);
  const plateValid =
    plateForm.item_id !== '' && /^\d+$/.test(plateForm.plates) && platesCount >= 1 && platesCount <= 10_000;

  const openEditor = async () => {
    setEdit({
      hall_id: b.hall_id,
      starts_at: instantToBranchLocal(new Date(b.starts_at), tz),
      ends_at: instantToBranchLocal(new Date(b.ends_at), tz),
      guest_count: b.guest_count,
      extra_pax: b.extra_pax,
      apply_gst: b.gst_rate_bps > 0,
      notes: b.notes ?? '',
    });
    setEditing(true);
    if (!ctx) return;
    const list = await banquetApi.listHalls(ctx).catch(() => null);
    if (list) setHalls(list.data.filter((h) => h.status === 'ACTIVE' || h.id === b.hall_id));
  };

  const saveEdit = () => {
    if (!edit) return;
    const startsAt = branchLocalToInstant(edit.starts_at, tz);
    const endsAt = branchLocalToInstant(edit.ends_at, tz);
    if (!startsAt || !endsAt) {
      setActionError('Enter a valid start and end time.');
      return;
    }
    // Only what changed is sent, so the audit trail records exactly that.
    const body: Parameters<typeof banquetApi.updateBooking>[2] = {};
    if (edit.hall_id !== b.hall_id) body.hall_id = edit.hall_id;
    if (startsAt.getTime() !== new Date(b.starts_at).getTime()) body.starts_at = startsAt.toISOString();
    if (endsAt.getTime() !== new Date(b.ends_at).getTime()) body.ends_at = endsAt.toISOString();
    if (edit.guest_count !== b.guest_count) body.guest_count = edit.guest_count;
    if (edit.extra_pax !== b.extra_pax) body.extra_pax = edit.extra_pax;
    if (edit.apply_gst !== b.gst_rate_bps > 0) body.apply_gst = edit.apply_gst;
    const notes = edit.notes.trim() || null;
    if (notes !== b.notes) body.notes = notes;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    void run(async () => {
      await banquetApi.updateBooking(ctx!, b.id, body);
      setEditing(false);
    }, 'Booking updated and re-priced.');
  };

  return (
    <>
      <div className={styles.bar}>
        <Link href="/banquet" className={styles.link}>
          ← Bookings
        </Link>
        <span className={styles.spacer} />
        <Link href={`/banquet/${b.id}/bill`} className={styles.link}>
          Print bill
        </Link>
        {b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? (
          <Link href={`/banquet/${b.id}/kot`} className={styles.link}>
            Print KOT
          </Link>
        ) : null}
        <span className={`${styles.badge} ${BADGE[b.status]}`}>{BOOKING_STATUS_LABEL[b.status]}</span>
        {b.status !== 'DRAFT' ? (
          <span className={`${styles.badge} ${PAYMENT_BADGE[b.payment_status]}`}>
            {PAYMENT_STATUS_LABEL[b.payment_status]}
          </span>
        ) : null}
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
      {live && started && !may.editPast && (may.update || permittedKinds.length > 0) ? (
        <p className={styles.warning}>
          This event has already started. Changing its details or price needs the past-booking edit
          permission.
        </p>
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
        {live && may.update && alterable && !editing ? (
          <button type="button" className={styles.action} disabled={busy} onClick={() => void openEditor()}>
            Edit booking
          </button>
        ) : null}
        {live && may.cancel && !cancelOpen ? (
          <button
            type="button"
            className={`${styles.action} ${styles.danger}`}
            disabled={busy}
            onClick={() => {
              setCancelReason('');
              setCancelOpen(true);
            }}
          >
            Cancel booking
          </button>
        ) : null}
      </div>

      {cancelOpen && live ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await banquetApi.cancelBooking(ctx!, b.id, cancelReason.trim() || undefined);
              setCancelOpen(false);
            }, 'Booking cancelled — the hall is free again.');
          }}
        >
          <div>
            <label className={styles.label} htmlFor="c-reason">
              Reason for cancelling (optional)
            </label>
            <textarea
              id="c-reason"
              className={styles.textarea}
              maxLength={500}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <p className={styles.hint}>
              Payments already taken stay on record against this booking; nothing is refunded here.
            </p>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.action} ${styles.danger}`} disabled={busy}>
              Confirm cancellation
            </button>
            <button type="button" className={styles.action} onClick={() => setCancelOpen(false)}>
              Keep booking
            </button>
          </div>
        </form>
      ) : null}

      {editing && edit ? (
        <form
          className={styles.form}
          aria-label="Edit booking"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="e-hall">
                Hall
              </label>
              <select
                id="e-hall"
                className={styles.select}
                value={edit.hall_id}
                onChange={(e) => setEdit({ ...edit, hall_id: e.target.value })}
              >
                {halls.length === 0 ? <option value={b.hall_id}>{b.hall_name}</option> : null}
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} · seats {h.capacity}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="e-start">
                Starts
              </label>
              <input
                id="e-start"
                type="datetime-local"
                className={styles.input}
                value={edit.starts_at}
                onChange={(e) => setEdit({ ...edit, starts_at: e.target.value })}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="e-end">
                Ends
              </label>
              <input
                id="e-end"
                type="datetime-local"
                className={styles.input}
                value={edit.ends_at}
                onChange={(e) => setEdit({ ...edit, ends_at: e.target.value })}
              />
            </div>
          </div>
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div>
              <label className={styles.label} htmlFor="e-guests">
                Guaranteed guests
              </label>
              <input
                id="e-guests"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                className={styles.input}
                value={edit.guest_count}
                onChange={(e) =>
                  setEdit({ ...edit, guest_count: Math.max(1, Math.min(10000, Number.parseInt(e.target.value, 10) || 1)) })
                }
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="e-extra">
                Extra pax
              </label>
              <input
                id="e-extra"
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                className={styles.input}
                value={edit.extra_pax}
                onChange={(e) =>
                  setEdit({ ...edit, extra_pax: Math.max(0, Math.min(10000, Number.parseInt(e.target.value, 10) || 0)) })
                }
              />
            </div>
            <div>
              <span className={styles.label}>GST</span>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={edit.apply_gst}
                  onChange={(e) => setEdit({ ...edit, apply_gst: e.target.checked })}
                />
                Apply GST
              </label>
              <p className={styles.hint}>Turning GST on applies the branch&rsquo;s current rate.</p>
            </div>
          </div>
          <div>
            <label className={styles.label} htmlFor="e-notes">
              Booking notes
            </label>
            <textarea
              id="e-notes"
              className={styles.textarea}
              value={edit.notes}
              onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
            />
          </div>
          <p className={styles.hint}>
            Times are in the branch&rsquo;s timezone ({tz}). The price is recalculated from this booking&rsquo;s own
            rate, never the package&rsquo;s current price.
          </p>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy}>
              Save changes
            </button>
            <button type="button" className={styles.action} onClick={() => setEditing(false)}>
              Discard
            </button>
          </div>
        </form>
      ) : null}

      <div className={styles.columns}>
        <div>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Event</h2>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Hall</span>
                <span>{b.hall_name}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Starts</span>
                <span>{formatDateTime(b.starts_at, tz)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Ends</span>
                <span>{formatDateTime(b.ends_at, tz)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Guests</span>
                <span>
                  {b.guest_count}
                  {b.extra_pax > 0 ? ` guaranteed + ${b.extra_pax} extra` : ''}
                </span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Package</span>
                <span>
                  {b.package_name} · {money(b.price_per_guest_minor)}/guest
                </span>
              </div>
              {b.notes ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Notes</span>
                  <span>{b.notes}</span>
                </div>
              ) : null}
              {b.cancellation_reason ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Cancelled because</span>
                  <span>{b.cancellation_reason}</span>
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

          {b.status === 'CONFIRMED' || b.status === 'COMPLETED' || (plateRequests?.length ?? 0) > 0 ? (
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Plates</h2>
              {platesError ? (
                <p role="alert" className={styles.error}>
                  {platesError}
                </p>
              ) : null}
              {plateRequests && plateRequests.length > 0 ? (
                <ul className={styles.items} aria-label="Plate requests for this booking">
                  {plateRequests.map((p) => (
                    <li key={p.id} className={styles.item}>
                      <span className={styles.itemName}>
                        {p.plates} × {p.item.name}
                        <span className={styles.meta}>
                          {' '}
                          · {formatDateTime(p.requested_at, tz)} · {p.requested_by.name}
                          {p.note ? ` · “${p.note}”` : ''}
                          {p.rejection_reason ? ` · ${p.rejection_reason}` : ''}
                        </span>
                      </span>
                      <span className={styles.badge}>{PLATE_STATUS_LABEL[p.status]}</span>
                    </li>
                  ))}
                </ul>
              ) : plateRequests ? (
                <p className={styles.empty}>No plates requested yet.</p>
              ) : null}
              {may.requestPlates && b.status === 'CONFIRMED' && b.items.length > 0 ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!plateValid) return;
                    const note = plateForm.note.trim();
                    void run(async () => {
                      await banquetApi.requestPlates(ctx!, b.id, {
                        item_id: plateForm.item_id,
                        plates: platesCount,
                        ...(note ? { note } : {}),
                      });
                      setPlateForm({ item_id: '', plates: '', note: '' });
                      setPlatesNonce((n) => n + 1);
                    }, 'Plate request sent to the kitchen.');
                  }}
                >
                  <div className={`${styles.grid} ${styles.grid3}`}>
                    <div>
                      <label className={styles.label} htmlFor="plate-item">
                        Dish
                      </label>
                      <select
                        id="plate-item"
                        className={styles.select}
                        value={plateForm.item_id}
                        onChange={(e) => setPlateForm({ ...plateForm, item_id: e.target.value })}
                      >
                        <option value="">Choose a dish</option>
                        {b.items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={styles.label} htmlFor="plate-count">
                        Plates
                      </label>
                      <input
                        id="plate-count"
                        className={styles.input}
                        inputMode="numeric"
                        value={plateForm.plates}
                        onChange={(e) => setPlateForm({ ...plateForm, plates: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={styles.label} htmlFor="plate-note">
                        Note for the kitchen (optional)
                      </label>
                      <input
                        id="plate-note"
                        className={styles.input}
                        maxLength={200}
                        value={plateForm.note}
                        onChange={(e) => setPlateForm({ ...plateForm, note: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className={styles.actions} style={{ marginTop: 'var(--gap)' }}>
                    <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy || !plateValid}>
                      Request plates
                    </button>
                  </div>
                  <p className={styles.hint}>Someone in the kitchen other than you approves or rejects the request.</p>
                </form>
              ) : null}
            </section>
          ) : null}

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Event plan</h2>
            {may.plan && b.status !== 'CANCELLED' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const serviceAt = plan.service_at ? branchLocalToInstant(plan.service_at, tz) : null;
                  if (plan.service_at && !serviceAt) {
                    setActionError('Enter a valid service time.');
                    return;
                  }
                  void run(
                    () =>
                      banquetApi.saveEventPlan(ctx!, b.id, {
                        service_at: serviceAt ? serviceAt.toISOString() : null,
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
                  <span>{formatDateTime(b.event_plan?.service_at ?? null, tz)}</span>
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
            <h2 className={styles.panelTitle}>Bill &amp; balance</h2>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>
                  Base · {b.guest_count} × {money(b.price_per_guest_minor)}
                </span>
                <span className={styles.money}>{money(inv.base_minor)}</span>
              </div>
              {inv.extra_pax_minor > 0 ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Extra pax · {b.extra_pax}</span>
                  <span className={styles.money}>{money(inv.extra_pax_minor)}</span>
                </div>
              ) : null}
              {inv.extra_charges_minor > 0 ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Extra charges</span>
                  <span className={styles.money}>{money(inv.extra_charges_minor)}</span>
                </div>
              ) : null}
              {inv.discount_minor > 0 ? (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Discounts</span>
                  <span className={`${styles.money} ${styles.discount}`}>−{money(inv.discount_minor)}</span>
                </div>
              ) : null}
              <div className={styles.row}>
                <span className={styles.rowLabel}>Taxable value</span>
                <span className={styles.money}>{money(inv.taxable_minor)}</span>
              </div>
              {inv.gst_rate_bps > 0 ? (
                <>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>CGST · {percent(inv.gst_rate_bps / 2)}</span>
                    <span className={styles.money}>{money(inv.cgst_minor)}</span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>SGST · {percent(inv.gst_rate_bps / 2)}</span>
                    <span className={styles.money}>{money(inv.sgst_minor)}</span>
                  </div>
                </>
              ) : (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>GST</span>
                  <span>Not applied</span>
                </div>
              )}
              <div className={styles.row}>
                <span className={`${styles.rowLabel} ${styles.subtotal}`}>Total</span>
                <span className={styles.money}>{money(b.balance.total_amount_minor)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Paid</span>
                <span className={`${styles.money} ${styles.paid}`}>{money(b.balance.paid_minor)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Balance due</span>
                <span className={`${styles.balanceTotal} ${b.balance.fully_paid ? styles.paid : styles.due}`}>
                  {money(b.balance.balance_minor)}
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
            <h2 className={styles.panelTitle}>Charges &amp; discounts</h2>
            {b.adjustments.length === 0 ? (
              <p className={styles.empty}>No extra charges or discounts.</p>
            ) : (
              <ul className={styles.items}>
                {b.adjustments.map((a) => (
                  <li key={a.id} className={styles.item}>
                    <span className={`${styles.itemName} ${a.active ? '' : styles.withdrawn}`}>
                      {ADJUSTMENT_LABEL[a.kind]} · {a.description}
                      {a.kind === 'PER_HEAD_DISCOUNT' ? ' (per plate)' : ''}
                    </span>
                    <span className={`${styles.money} ${isDiscount(a.kind) ? styles.discount : ''}`}>
                      {isDiscount(a.kind) ? '−' : '+'}
                      {money(a.amount_minor)}
                    </span>
                    {a.active && alterable && can(ADJUSTMENT_PERMISSION[a.kind]) ? (
                      <button
                        type="button"
                        className={styles.action}
                        disabled={busy}
                        aria-label={`Withdraw ${a.description}`}
                        onClick={() =>
                          void run(
                            () => banquetApi.reverseAdjustment(ctx!, b.id, a.id),
                            'Line withdrawn and the bill recalculated.',
                          )
                        }
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {alterable && permittedKinds.length > 0 ? (
              <form
                style={{ marginTop: 'var(--gap)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!lineValid || !line.kind || lineMinor === null) return;
                  const kind = line.kind;
                  void run(async () => {
                    await banquetApi.addAdjustment(ctx!, b.id, {
                      kind,
                      description: line.description.trim(),
                      amount_minor: lineMinor,
                    });
                    setLine({ kind: '', description: '', amount: '' });
                  }, 'Line added and the bill recalculated.');
                }}
              >
                <div className={`${styles.grid} ${styles.grid3}`}>
                  <div>
                    <label className={styles.label} htmlFor="l-kind">
                      Line type
                    </label>
                    <select
                      id="l-kind"
                      className={styles.select}
                      value={line.kind}
                      onChange={(e) => setLine({ ...line, kind: e.target.value as BanquetAdjustmentKind | '' })}
                    >
                      <option value="">Select…</option>
                      {permittedKinds.map((k) => (
                        <option key={k} value={k}>
                          {ADJUSTMENT_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="l-description">
                      Description
                    </label>
                    <input
                      id="l-description"
                      className={styles.input}
                      maxLength={200}
                      value={line.description}
                      onChange={(e) => setLine({ ...line, description: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="l-amount">
                      {line.kind === 'PER_HEAD_DISCOUNT' ? `Per plate (${b.currency})` : `Line amount (${b.currency})`}
                    </label>
                    <input
                      id="l-amount"
                      className={styles.input}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.amount}
                      onChange={(e) => setLine({ ...line, amount: e.target.value })}
                    />
                  </div>
                </div>
                <div className={styles.actions} style={{ marginTop: 'var(--gap)' }}>
                  <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy || !lineValid}>
                    Add line
                  </button>
                </div>
              </form>
            ) : null}
            <p className={styles.hint}>Lines are never edited or deleted; withdrawing one records a reversal.</p>
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
                      {formatDateTime(p.paid_at, tz)}
                      {p.kind ? ` · ${PAYMENT_KIND_LABEL[p.kind]}` : ''}
                      {p.method ? ` · ${p.method}` : ''}
                    </span>
                    <span className={styles.money}>{formatMinor(p.amount_minor, p.currency, 'en-IN')}</span>
                    {p.verification ? (
                      <span className={`${styles.badge} ${styles.badgePaid}`}>Verified</span>
                    ) : may.verify && user?.id !== p.actor_user_id ? (
                      <button
                        type="button"
                        className={styles.action}
                        disabled={busy}
                        aria-label={`Verify payment of ${formatMinor(p.amount_minor, p.currency, 'en-IN')}`}
                        onClick={() => void run(() => banquetApi.verifyPayment(ctx!, p.id), 'Payment verified.')}
                      >
                        Verify
                      </button>
                    ) : (
                      <span className={styles.badge}>Not verified</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.hint}>
              Payments are a permanent record and cannot be edited. A payment is verified by someone other than
              the person who recorded it.
            </p>
          </section>

          <RecordHistory entityType="BANQUET_BOOKING" entityId={b.id} />
        </div>
      </div>
    </>
  );
}
