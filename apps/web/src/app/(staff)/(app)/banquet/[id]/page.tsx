'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor } from '@/lib/banquet/money';
import { useNow } from '@/lib/queue/use-now';
import { deviceTimeZone, formatDateTime } from '@/lib/format/datetime';
import {
  BOOKING_STATUS_LABEL,
  KDS_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_STATUS_LABEL,
  type BanquetBookingDetail,
  type BanquetBookingPhoto,
  type BanquetBookingStatus,
  type BanquetPaymentStatus,
} from '@/lib/banquet/types';
import styles from '@/components/banquet/banquet.module.css';
import formStyles from '@/components/banquet/booking-form.module.css';
import { AppIcon } from '@/components/app/icons';
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

/**
 * Read-only booking detail: status, lifecycle actions (confirm / complete /
 * cancel) and a summary of the bill, payments, menu and photos. Anything that
 * CHANGES the booking — hall/date/guests/customer, discounts, payments,
 * kitchen ordering, photos — lives on the dedicated Edit Booking screen
 * (`/banquet/[id]/edit`), reached through the Edit button below.
 */
export default function BanquetBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params.id;
  const router = useRouter();
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
    create: can('banquet.booking.create'),
    editLocked: can('banquet.booking.edit_locked'),
    complete: can('banquet.booking.complete'),
    cancel: can('banquet.booking.cancel'),
    remove: can('banquet.booking.delete'),
    verify: can('banquet.payment.verify'),
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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const next = await banquetApi.getBooking(ctx, bookingId);
      setBooking(next);
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

  const bookingUpdatedAt = booking?.updated_at;
  const [photos, setPhotos] = useState<BanquetBookingPhoto[]>([]);
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await banquetApi.listPhotos(ctx, bookingId);
        if (!cancelled) setPhotos(list);
      } catch {
        // Non-critical — photos section simply stays empty
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, bookingId, bookingUpdatedAt]);

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
  const editable = live || (b.status === 'COMPLETED' && may.editLocked);
  // A draft can be deleted; a confirmed or completed booking only with the
  // Super-Admin override. A cancelled booking already released its hall and
  // is never deletable.
  const deletable =
    may.remove &&
    (b.status === 'DRAFT' || ((b.status === 'CONFIRMED' || b.status === 'COMPLETED') && may.editLocked));

  const deleteBooking = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await banquetApi.deleteBooking(ctx!, b.id);
      router.push('/banquet/calendar');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete the booking');
      setBusy(false);
    }
  };

  return (
    <>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className={styles.bar}>
        <Link href="/banquet" className={styles.link}>&larr; Bookings</Link>
        <span className={styles.spacer} />
        <Link href={`/banquet/${b.id}/bill`} className={styles.link}>Print bill</Link>
        {b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? (
          <Link href={`/banquet/${b.id}/kot`} className={styles.link}>Print KOT</Link>
        ) : null}
        <span className={`${styles.badge} ${BADGE[b.status]}`}>{BOOKING_STATUS_LABEL[b.status]}</span>
        {b.status !== 'DRAFT' ? (
          <span className={`${styles.badge} ${PAYMENT_BADGE[b.payment_status]}`}>
            {PAYMENT_STATUS_LABEL[b.payment_status]}
          </span>
        ) : null}
      </div>

      <h1>{b.customer?.name ?? 'Booking'}</h1>

      {actionError ? <div role="alert" className={styles.error}>{actionError}</div> : null}
      {loadError ? <div role="alert" className={styles.error}>{loadError}</div> : null}
      {notice ? <div role="status" aria-live="polite" className={styles.notice}>{notice}</div> : null}

      {/* ── Lifecycle buttons ───────────────────────────────────────────── */}
      <div className={styles.actions} style={{ marginBottom: 'var(--gap-lg)' }}>
        {editable && may.update ? (
          <Link href={`/banquet/${b.id}/edit`} className={`${styles.action} ${styles.primary}`}>
            Edit booking
          </Link>
        ) : null}
        {live && may.update ? (
          <Link href={`/banquet/${b.id}/edit?pick=move`} className={styles.action}>
            Move to another date
          </Link>
        ) : null}
        {live && may.create ? (
          <Link href={`/banquet/${b.id}/edit?pick=add`} className={styles.action}>
            Add another slot
          </Link>
        ) : null}
        {b.status === 'CONFIRMED' && may.complete ? (
          <button type="button" className={`${styles.action} ${styles.primary}`} disabled={busy}
            onClick={() => void run(() => banquetApi.completeBooking(ctx!, b.id), 'Event marked as completed.')}>
            Mark completed
          </button>
        ) : null}
        {live && may.cancel && !cancelOpen ? (
          <button type="button" className={`${styles.action} ${styles.danger}`} disabled={busy}
            onClick={() => { setCancelReason(''); setCancelOpen(true); }}>
            Cancel booking
          </button>
        ) : null}
        {deletable && !deleteOpen ? (
          <button type="button" className={`${styles.action} ${styles.danger}`} disabled={busy}
            onClick={() => { setCancelOpen(false); setDeleteOpen(true); }}>
            Delete booking
          </button>
        ) : null}
      </div>

      {deleteOpen && deletable ? (
        <div role="alertdialog" aria-label="Delete this booking?" className={styles.form}>
          <p>
            <strong>Delete this booking permanently?</strong> The booking
            {b.payments.length > 0 ? ', its payment history' : ''} and its menu will be removed and the hall freed.
            This can&rsquo;t be undone; a record of what was deleted is kept in the audit history.
          </p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.action} ${styles.danger}`} disabled={busy}
              onClick={() => void deleteBooking()}>
              Yes, delete booking
            </button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => setDeleteOpen(false)}>
              Keep booking
            </button>
          </div>
        </div>
      ) : null}

      {cancelOpen && live ? (
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void run(async () => { await banquetApi.cancelBooking(ctx!, b.id, cancelReason.trim() || undefined); setCancelOpen(false); }, 'Booking cancelled — the hall is free again.'); }}>
          <div>
            <label className={styles.label} htmlFor="c-reason">Reason for cancelling (optional)</label>
            <textarea id="c-reason" className={styles.textarea} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <p className={styles.hint}>Payments already taken stay on record against this booking; nothing is refunded here.</p>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.action} ${styles.danger}`} disabled={busy}>Confirm cancellation</button>
            <button type="button" className={styles.action} onClick={() => setCancelOpen(false)}>Keep booking</button>
          </div>
        </form>
      ) : null}

      {/* ── Event details (read-only) ───────────────────────────────────── */}
      <section className={formStyles.section}>
        <div className={formStyles.sectionHead}>
          <AppIcon name="calendar" size={20} />
          <h2 className={formStyles.sectionTitle}>Event</h2>
        </div>
        <div className={styles.rows}>
          <div className={styles.row}><span className={styles.rowLabel}>Hall</span><span>{b.hall_name}</span></div>
          <div className={styles.row}><span className={styles.rowLabel}>Starts</span><span>{formatDateTime(b.starts_at, tz)}</span></div>
          <div className={styles.row}><span className={styles.rowLabel}>Ends</span><span>{formatDateTime(b.ends_at, tz)}</span></div>
          <div className={styles.row}><span className={styles.rowLabel}>Guests</span><span>{b.guest_count}{b.extra_pax > 0 ? ` + ${b.extra_pax} extra` : ''}</span></div>
          <div className={styles.row}><span className={styles.rowLabel}>Package</span><span>{b.package_name || '—'} {b.package_name ? `· ${money(b.price_per_guest_minor)}/guest` : ''}</span></div>
          {b.notes ? <div className={styles.row}><span className={styles.rowLabel}>Notes</span><span>{b.notes}</span></div> : null}
          {b.cancellation_reason ? <div className={styles.row}><span className={styles.rowLabel}>Cancelled because</span><span>{b.cancellation_reason}</span></div> : null}
        </div>
      </section>

      {/* ── Bill & balance ───────────────────────────────────────────────── */}
      <section className={formStyles.section}>
        <table className={formStyles.paymentTable}>
          <tbody>
            <tr><td>Final Amount:</td><td>{money(b.balance.total_amount_minor)}</td></tr>
            <tr><td>Total Paid:</td><td>{money(b.balance.paid_minor)}</td></tr>
            <tr><td>Balance:</td><td>{money(b.balance.balance_minor)}</td></tr>
          </tbody>
        </table>
      </section>

      {/* ── Payment History (read + verify) ─────────────────────────────── */}
      <section className={formStyles.section}>
        <div className={formStyles.sectionHead}>
          <AppIcon name="wallet" size={20} />
          <h2 className={formStyles.sectionTitle}>Payment History</h2>
        </div>
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
                  <button type="button" className={styles.action} disabled={busy}
                    aria-label={`Verify payment of ${formatMinor(p.amount_minor, p.currency, 'en-IN')}`}
                    onClick={() => void run(() => banquetApi.verifyPayment(ctx!, p.id), 'Payment verified.')}>
                    Verify
                  </button>
                ) : (
                  <span className={styles.badge}>Not verified</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Reference Photos (read-only) ────────────────────────────────── */}
      {photos.length > 0 ? (
        <section className={formStyles.section}>
          <div className={formStyles.photosHead}>
            <span className={formStyles.photosIcon}><AppIcon name="calendar" size={20} /></span>
            <h2 className={formStyles.photosTitle}>Reference Photos ({photos.length}/5)</h2>
          </div>
          <div className={formStyles.photosGrid}>
            {photos.map((p) => <PhotoThumb key={p.id} bookingId={bookingId} photo={p} />)}
          </div>
        </section>
      ) : null}

      {/* ── Menu Selection (read-only) ──────────────────────────────────── */}
      <section className={formStyles.section}>
        <div className={formStyles.menuHead}>
          <span className={formStyles.menuIcon}><AppIcon name="fork" size={20} /></span>
          <h2 className={formStyles.menuTitle}>Menu Selection</h2>
        </div>
        {b.items.length === 0 ? (
          <p className={styles.empty}>This package has no menu components.</p>
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

      {/* ── History (collapsible) ───────────────────────────────────────── */}
      <RecordHistory entityType="BANQUET_BOOKING" entityId={b.id} />
    </>
  );
}

function PhotoThumb({ bookingId, photo }: { bookingId: string; photo: BanquetBookingPhoto }) {
  const [src, setSrc] = useState<string | null>(null);
  const { selectedCompanyId, selectedBranchId } = useAppContext();

  useEffect(() => {
    if (!selectedCompanyId || !selectedBranchId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { apiBaseUrl } = await import('@/lib/api/client');
        const { sessionStore } = await import('@/lib/auth/session-store');
        const token = sessionStore.getAccessToken();
        const res = await fetch(`${apiBaseUrl()}/banquet/bookings/${bookingId}/photos/${photo.id}`, {
          headers: {
            'x-company-id': selectedCompanyId,
            'x-branch-id': selectedBranchId,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (!cancelled) setSrc(URL.createObjectURL(blob));
      } catch {
        // Photo display is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCompanyId, selectedBranchId, bookingId, photo.id]);

  if (!src) return <div className={formStyles.photoThumb} />;
  return (
    <div className={formStyles.photoThumb}>
      <img src={src} alt={photo.file_name ?? 'Reference photo'} />
    </div>
  );
}
