'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor, minorUnitDigits, toMinor } from '@/lib/banquet/money';
import { branchLocalToInstant, instantToBranchLocal } from '@/lib/queue/branch-time';
import { useNow } from '@/lib/queue/use-now';
import { deviceTimeZone, formatDateTime, branchToday, addCalendarDays } from '@/lib/format/datetime';
import {
  ADJUSTMENT_LABEL,
  ADJUSTMENT_PERMISSION,
  KDS_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PLATE_STATUS_LABEL,
  type PlateRequest,
  type BanquetAdjustmentKind,
  type BanquetBookingDetail,
  type BanquetBookingPhoto,
  type BanquetPackage,
  type AvailabilityHallDay,
} from '@/lib/banquet/types';
import styles from '@/components/banquet/banquet.module.css';
import formStyles from '@/components/banquet/booking-form.module.css';
import availStyles from '@/components/banquet/availability.module.css';
import chrome from '@/components/app/screen-chrome.module.css';
import { AppIcon } from '@/components/app/icons';
import { RecordHistory } from '@/components/audit/record-history';

const KINDS = Object.keys(ADJUSTMENT_LABEL) as BanquetAdjustmentKind[];

interface HallSelection {
  hall_id: string;
  hall_name: string;
  slot_name: string;
  starts_at: string;
  ends_at: string;
}

function CollapsibleSection({ title, count, icon, color, children, defaultOpen }: {
  title: string;
  count?: string;
  icon?: React.ReactNode;
  color?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className={`${formStyles.section} ${formStyles.collapsible} ${open ? formStyles.collapsibleExpanded : ''}`}>
      <button type="button" className={formStyles.collapsibleTitle} onClick={() => setOpen(!open)}
        style={color ? { color } : undefined}>
        {icon ?? <AppIcon name={open ? 'chevronUp' : 'chevronDown'} size={18} />}
        <span style={{ flex: 1 }}>{title}</span>
        {count ? <span className={formStyles.collapsibleCount}>{count}</span> : null}
      </button>
      {open ? <div className={formStyles.collapsibleBody}>{children}</div> : null}
    </section>
  );
}

/**
 * Date + hall/slot picker. The same availability data and the same DB
 * exclusion constraint that guards New Booking guard this too — a slot taken
 * by someone else is simply not selectable, and the server still refuses a
 * double-book even if two people race this at once. The booking's OWN current
 * slot is shown as available (labelled "Current") rather than "Booked", so
 * re-selecting the same slot works.
 */
function SlotPicker({
  date: initialDate,
  tz,
  ctx,
  bookingId,
  sameDayOnly = false,
  title,
  onSelect,
  onClose,
}: {
  date: string;
  tz: string;
  ctx: { companyId: string; branchId: string };
  bookingId: string;
  /** Adding a slot is for the same day as the booking, so the date is fixed. */
  sameDayOnly?: boolean;
  title?: string;
  onSelect: (sel: HallSelection) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [halls, setHalls] = useState<AvailabilityHallDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = branchToday(tz);
  const isPast = date < today;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const av = await banquetApi.availability(ctx, { from: date, to: date });
        if (cancelled) return;
        setHalls(av.days[0]?.halls ?? []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load availability');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, date]);

  const fullDate = (() => {
    const d = new Date(`${date}T00:00:00.000Z`);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  })();

  return (
    <div className={availStyles.sheetBackdrop} onClick={onClose}>
      <div className={availStyles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title ?? 'Choose date and hall'}>
        <div className={availStyles.sheetHandle} />
        <div className={availStyles.sheetHeader}>
          <span className={availStyles.sheetIcon} data-tone="terracotta">
            <AppIcon name="calendar" size={24} />
          </span>
          <h2 className={availStyles.sheetTitle}>
            {title ? <span style={{ display: 'block', fontSize: '0.8em', opacity: 0.75 }}>{title}</span> : null}
            {fullDate}
          </h2>
          <button type="button" className={availStyles.sheetClose} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        {sameDayOnly ? null : (
          <div className={availStyles.sheetFilters}>
            <button type="button" className={availStyles.sheetPill}
              onClick={() => setDate((d) => addCalendarDays(d, -1))} disabled={date <= today}>
              &larr; Previous day
            </button>
            <input
              type="date"
              aria-label="Go to date"
              className={availStyles.sheetPill}
              min={today}
              value={date}
              onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
            />
            <button type="button" className={availStyles.sheetPill}
              onClick={() => setDate((d) => addCalendarDays(d, 1))}>
              Next day &rarr;
            </button>
          </div>
        )}
        <div className={availStyles.sheetBody}>
          {loading ? <p className={styles.empty}>Loading availability&hellip;</p> : null}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          {!loading && !error
            ? halls.map((hall) => (
                <div key={hall.hall_id} className={availStyles.hallCard}>
                  <div className={availStyles.hallHead}>
                    <span className={availStyles.hallIcon} data-tone="terracotta">
                      <AppIcon name="building" size={22} />
                    </span>
                    <span className={availStyles.hallName}>{hall.hall_name}</span>
                  </div>
                  <div className={availStyles.hallSlots}>
                    {hall.slots.map((slot) => {
                      const isCurrent = slot.booking_ids.length === 1 && slot.booking_ids[0] === bookingId;
                      const selectable = slot.state === 'available' || isCurrent;
                      return (
                        <div key={slot.slot_id} className={availStyles.slotRow}>
                          <span className={selectable ? availStyles.slotAvailIcon : availStyles.slotBookedIcon}>
                            <AppIcon name={selectable ? 'checkCircle' : 'noEntry'} size={22} />
                          </span>
                          <span className={availStyles.slotName}>{slot.name.toUpperCase()}</span>
                          {selectable ? (
                            isPast ? null : (
                              <button
                                type="button"
                                className={availStyles.slotSelect}
                                onClick={() =>
                                  onSelect({
                                    hall_id: hall.hall_id,
                                    hall_name: hall.hall_name,
                                    slot_name: slot.name,
                                    starts_at: slot.starts_at,
                                    ends_at: slot.ends_at,
                                  })
                                }
                              >
                                {isCurrent ? 'Keep' : 'Select'}
                              </button>
                            )
                          ) : (
                            <span className={availStyles.slotStatusTag}>Booked</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            : null}
          {!loading && !error && halls.length === 0 ? <p className={styles.empty}>No halls configured.</p> : null}
        </div>
        {isPast ? (
          <div className={availStyles.sheetFooter}>
            <p className={availStyles.pastNotice}>This date has passed and can&rsquo;t be selected.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The dedicated Edit Booking screen. Everything that changes a live booking
 * lives here — the read-only detail page only shows lifecycle actions
 * (confirm/complete/cancel) and a link into this screen.
 */
export default function BanquetBookingEditPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params.id;
  const router = useRouter();
  const search = useSearchParams();
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions, companyPermissions } =
    useAppContext();
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
  const canCompany = (key: string) => hasPermission(companyPermissions, key);
  const may = {
    create: can('banquet.booking.create'),
    editPast: can('banquet.booking.edit_past'),
    editLocked: can('banquet.booking.edit_locked'),
    remove: can('banquet.booking.delete'),
    pay: can('banquet.payment.create'),
    verify: can('banquet.payment.verify'),
    plan: can('banquet.event_plan.manage'),
    requestPlates: can('banquet.plate.request'),
    customerUpdate: canCompany('customers.update'),
  };
  const permittedKinds = KINDS.filter((k) => can(ADJUSTMENT_PERMISSION[k]));

  const [booking, setBooking] = useState<BanquetBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [initialCustomer, setInitialCustomer] = useState({ name: '', phone: '' });
  const [guestCount, setGuestCount] = useState('');
  const [hallSel, setHallSel] = useState<HallSelection | null>(null);
  // 'move' changes this booking's date/hall; 'add' books another slot the same day.
  const [picker, setPicker] = useState<'move' | 'add' | null>(() => {
    const pick = search.get('pick');
    return pick === 'move' || pick === 'add' ? pick : null;
  });
  const [addingSlot, setAddingSlot] = useState(false);
  const [packageId, setPackageId] = useState('');
  const [packages, setPackages] = useState<BanquetPackage[]>([]);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  // Staged, not sent yet — recorded only when Update Booking is tapped, so it
  // never changes the totals shown above until the whole edit is saved.
  const [pendingPayment, setPendingPayment] = useState<{ amount_minor: number; method: string } | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMethod, setEditMethod] = useState('');
  const [plan, setPlan] = useState({ service_at: '', setup_notes: '', kitchen_notes: '' });
  const [line, setLine] = useState<{ kind: BanquetAdjustmentKind | ''; description: string; amount: string }>({
    kind: '',
    description: '',
    amount: '',
  });
  const [discountMode, setDiscountMode] = useState<'amount' | 'percentage' | 'per_head'>('amount');
  const [discountInput, setDiscountInput] = useState('');

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const next = await banquetApi.getBooking(ctx, bookingId);
      setBooking(next);
      setGuestCount(String(next.guest_count));
      setHallSel({
        hall_id: next.hall_id,
        hall_name: next.hall_name,
        slot_name: '',
        starts_at: next.starts_at,
        ends_at: next.ends_at,
      });
      setPackageId(next.package_id ?? '');
      setPlan({
        service_at: next.event_plan?.service_at ? instantToBranchLocal(new Date(next.event_plan.service_at), tz) : '',
        setup_notes: next.event_plan?.setup_notes ?? '',
        kitchen_notes: next.event_plan?.kitchen_notes ?? '',
      });
      if (next.customer) {
        const full = await banquetApi.getCustomer(ctx, next.customer.id).catch(() => null);
        const name = full?.name ?? next.customer.name;
        const phone = full?.phone ?? '';
        setCustomerName(name);
        setCustomerPhone(phone);
        setInitialCustomer({ name, phone });
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the booking');
    } finally {
      setLoading(false);
    }
  }, [ctx, bookingId, tz]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      const list = await banquetApi.listPackages(ctx).catch(() => null);
      if (list && !cancelled) setPackages(list.data.filter((p) => p.status === 'ACTIVE'));
    })();
    return () => { cancelled = true; };
  }, [ctx]);

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
    return () => { cancelled = true; };
  }, [ctx, bookingId, bookingUpdatedAt, platesNonce]);

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

  /** Runs an action, then reconciles with the server. Resolves to whether it succeeded. */
  const run = async (fn: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    let ok = false;
    try {
      await fn();
      ok = true;
      setNotice(success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      await refresh();
      setBusy(false);
    }
    return ok;
  };

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/banquet/${bookingId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Banquet booking', url });
        return;
      }
    } catch {
      // Fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Booking link copied to clipboard.');
    } catch {
      // Nothing more to offer without clipboard access
    }
  };

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading booking&hellip;
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
  const live =
    b.status === 'DRAFT' || b.status === 'CONFIRMED' || (b.status === 'COMPLETED' && may.editLocked);

  if (!live) {
    return (
      <div className={chrome.content}>
        <div role="alert" className={styles.error}>
          <p>A {b.status.toLowerCase()} booking can no longer be edited.</p>
          <Link href={`/banquet/${b.id}`} className={styles.link}>
            Back to the booking
          </Link>
        </div>
      </div>
    );
  }

  const started = new Date(b.starts_at).getTime() <= now;
  const alterable = !started || may.editPast || may.editLocked;
  // A draft can be deleted outright; a booked (confirmed) or completed one —
  // advance paid, hall held or already served — needs the Super-Admin
  // override too, same as editing it locked.
  const deletable =
    may.remove &&
    (b.status === 'DRAFT' || ((b.status === 'CONFIRMED' || b.status === 'COMPLETED') && may.editLocked));

  const deleteBooking = async () => {
    if (!ctx) return;
    setBusy(true);
    setActionError(null);
    try {
      await banquetApi.deleteBooking(ctx, b.id);
      router.push('/banquet/calendar');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete the booking');
      setBusy(false);
    }
  };
  // With no menu the booking has no price yet, so an advance of any size is accepted.
  const priced = b.package_id !== null;
  const payMinor = toMinor(amount, b.currency);
  const overBalance = priced && payMinor !== null && payMinor > b.balance.balance_minor;
  const payValid = payMinor !== null && payMinor >= 0 && !overBalance;
  const editingPayment = editingPaymentId ? b.payments.find((p) => p.id === editingPaymentId) ?? null : null;
  const editMinor = toMinor(editAmount, b.currency);
  // Correcting a payment frees up its own current amount before the new one is checked against the balance.
  const editMaxAllowed = priced ? b.balance.balance_minor + (editingPayment?.amount_minor ?? 0) : Infinity;
  const editValid = editMinor !== null && editMinor >= 0 && editMinor <= editMaxAllowed;
  const lineMinor = line.kind ? toMinor(line.amount, b.currency) : null;
  // "Amount" and "Per Head" are direct currency entries; "Percentage" is a
  // percent of the current taxable value, computed here into the same
  // flat amount_minor the API always takes — no separate backend concept.
  const canAdminDiscount = can(ADJUSTMENT_PERMISSION.ADMIN_DISCOUNT);
  const canPerHeadDiscount = can(ADJUSTMENT_PERMISSION.PER_HEAD_DISCOUNT);
  const discountKind: BanquetAdjustmentKind = discountMode === 'per_head' ? 'PER_HEAD_DISCOUNT' : 'ADMIN_DISCOUNT';
  const discountPercent = discountMode === 'percentage' ? Number.parseFloat(discountInput) : null;
  const discountMinor =
    discountMode === 'percentage'
      ? Number.isFinite(discountPercent) && discountPercent! > 0 && discountPercent! <= 100
        ? Math.round((b.invoice.taxable_minor * discountPercent!) / 100)
        : null
      : toMinor(discountInput, b.currency);
  const discountValid = discountMinor !== null && discountMinor > 0;
  const discountDescription =
    discountMode === 'percentage' ? `${discountInput.trim()}% discount` : ADJUSTMENT_LABEL[discountKind];
  const platesCount = Number(plateForm.plates);
  const plateValid =
    plateForm.item_id !== '' && /^\d+$/.test(plateForm.plates) && platesCount >= 1 && platesCount <= 10_000;

  const eventLocalDate = instantToBranchLocal(new Date(b.starts_at), tz).slice(0, 10);
  const kitchenLive = eventLocalDate === branchToday(tz);

  const selHallId = hallSel?.hall_id ?? b.hall_id;
  const selStartsAt = hallSel?.starts_at ?? b.starts_at;
  const selEndsAt = hallSel?.ends_at ?? b.ends_at;
  const selHallName = hallSel?.hall_name ?? b.hall_name;
  const selSlotName = hallSel?.slot_name ?? '';

  const customerChanged = customerName.trim() !== initialCustomer.name || customerPhone.trim() !== (initialCustomer.phone ?? '');
  const guestCountNum = Number.parseInt(guestCount, 10);
  const bookingBodyChanged =
    selHallId !== b.hall_id ||
    new Date(selStartsAt).getTime() !== new Date(b.starts_at).getTime() ||
    new Date(selEndsAt).getTime() !== new Date(b.ends_at).getTime() ||
    (Number.isFinite(guestCountNum) && guestCountNum !== b.guest_count) ||
    packageId !== (b.package_id ?? '');
  const canSave = customerChanged || bookingBodyChanged || !!pendingPayment;

  const saveAll = () =>
    run(async () => {
      if (b.customer && may.customerUpdate && customerChanged) {
        await banquetApi.updateCustomer(ctx!, b.customer.id, {
          name: customerName.trim(),
          phone: customerPhone.trim() || null,
        });
      }
      if (bookingBodyChanged) {
        const body: Parameters<typeof banquetApi.updateBooking>[2] = {};
        if (selHallId !== b.hall_id) body.hall_id = selHallId;
        if (new Date(selStartsAt).getTime() !== new Date(b.starts_at).getTime()) body.starts_at = selStartsAt;
        if (new Date(selEndsAt).getTime() !== new Date(b.ends_at).getTime()) body.ends_at = selEndsAt;
        if (Number.isFinite(guestCountNum) && guestCountNum !== b.guest_count) body.guest_count = guestCountNum;
        if (packageId !== (b.package_id ?? '')) body.package_id = packageId || null;
        await banquetApi.updateBooking(ctx!, b.id, body);
      }
      if (pendingPayment) {
        await banquetApi.createPayment(ctx!, b.id, {
          amount_minor: pendingPayment.amount_minor,
          currency: b.currency,
          ...(pendingPayment.method ? { method: pendingPayment.method } : {}),
        });
        setPendingPayment(null);
      }
    }, 'Booking updated.');

  // Back with unsaved changes asks first; with nothing changed it just goes.
  const backHref = `/banquet/${b.id}`;
  const saveAndLeave = async () => {
    setLeaveOpen(false);
    if (await saveAll()) router.push(backHref);
  };

  return (
    <>
      <header className={chrome.header}>
        <div className={chrome.headerRow}>
          <Link href={backHref} className={`${chrome.back} ${chrome.backBox}`} aria-label="Back to booking"
            onClick={(e) => {
              if (!canSave) return;
              e.preventDefault();
              setLeaveOpen(true);
            }}>
            <AppIcon name="back" />
          </Link>
          <div className={chrome.titles}>
            <p className={chrome.crumb}>Banquet</p>
            <h1 className={chrome.titleSerif}>Edit Booking</h1>
          </div>
          <button type="button" className={`${chrome.iconButton} ${chrome.iconPlain}`} aria-label="Share booking" onClick={() => void handleShare()}>
            <AppIcon name="share" size={20} />
          </button>
          <Link href={`/banquet/${b.id}/bill`} className={`${chrome.iconButton} ${chrome.iconPlain}`} aria-label="Print bill">
            <AppIcon name="receipt" size={20} />
          </Link>
        </div>
      </header>

      <div className={chrome.content}>
        {actionError ? <div role="alert" className={styles.error}>{actionError}</div> : null}
        {loadError ? <div role="alert" className={styles.error}>{loadError}</div> : null}
        {notice ? <div role="status" aria-live="polite" className={styles.notice}>{notice}</div> : null}
        {started && !alterable ? (
          <p className={styles.warning}>
            This event has already started. Changing its details or price needs the past-booking edit permission.
          </p>
        ) : null}

        {/* ── Date / Hall chips ───────────────────────────────────────────── */}
        <section className={formStyles.section}>
          <div className={formStyles.chips}>
            <span className={`${formStyles.chip} ${formStyles.chipDate}`}>
              <AppIcon name="calendar" size={18} />
              {formatDateTime(selStartsAt, tz).split(',')[0]}
            </span>
          </div>
          <div className={formStyles.chips} style={{ marginTop: 10 }}>
            <span className={`${formStyles.chip} ${formStyles.chipHall}`}>
              <AppIcon name="pin" size={18} />
              {selHallName}{selSlotName ? ` - ${selSlotName}` : ''}
            </span>
          </div>
          <p className={styles.hint} style={{ marginTop: 8 }}>
            {formatDateTime(selStartsAt, tz)} &ndash; {formatDateTime(selEndsAt, tz)}
          </p>
          <div className={styles.actions} style={{ marginTop: 10 }}>
            {alterable ? (
              <button type="button" className={styles.action} onClick={() => setPicker('move')}>
                <AppIcon name="calendar" size={16} /> Move to another date
              </button>
            ) : null}
            {live && may.create ? (
              <button type="button" className={styles.action} disabled={addingSlot} onClick={() => setPicker('add')}>
                <AppIcon name="plus" size={16} /> Add another slot
              </button>
            ) : null}
          </div>
        </section>

        {/* ── Customer Information ────────────────────────────────────────── */}
        <section className={formStyles.section}>
          <div className={formStyles.sectionHead}>
            <AppIcon name="person" size={22} />
            <h2 className={formStyles.sectionTitle}>Customer Information</h2>
          </div>
          <div className={formStyles.fieldGroup}>
            <div className={formStyles.field}>
              <label className={formStyles.fieldLabel} htmlFor="ed-cust-name"><AppIcon name="personAdd" size={16} /> Customer Name *</label>
              <input id="ed-cust-name" className={formStyles.input} value={customerName} disabled={!may.customerUpdate}
                onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.fieldLabel} htmlFor="ed-cust-phone"><AppIcon name="phone" size={16} /> Phone Number *</label>
              <input id="ed-cust-phone" className={formStyles.input} type="tel" value={customerPhone} disabled={!may.customerUpdate}
                onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.fieldLabel} htmlFor="ed-guest-count"><AppIcon name="people" size={16} /> Number of Guests (PAX) *</label>
              <input id="ed-guest-count" className={formStyles.input} type="number" min={1} max={10000} value={guestCount} disabled={!alterable}
                onChange={(e) => setGuestCount(e.target.value)} />
            </div>
          </div>
          {!may.customerUpdate ? (
            <p className={styles.hint}>You don&rsquo;t have permission to edit the customer&rsquo;s name or phone.</p>
          ) : null}
        </section>

        {/* ── Payment Information summary ─────────────────────────────────── */}
        <section className={formStyles.section}>
          <div className={formStyles.sectionHead}>
            <AppIcon name="wallet" size={22} />
            <h2 className={formStyles.sectionTitle}>Payment Information</h2>
          </div>
          <table className={formStyles.paymentTable}>
            <tbody>
              <tr><td>Menu Amount:</td><td>{money(b.invoice.base_minor + b.invoice.extra_pax_minor)}</td></tr>
              {b.invoice.gst_rate_bps > 0 ? (
                <>
                  <tr><td>CGST:</td><td>{money(b.invoice.cgst_minor)}</td></tr>
                  <tr><td>SGST:</td><td>{money(b.invoice.sgst_minor)}</td></tr>
                </>
              ) : (
                <tr><td>GST:</td><td>Not applied</td></tr>
              )}
              <tr><td>Final Amount:</td><td>{money(b.balance.total_amount_minor)}</td></tr>
              <tr><td>Total Paid:</td><td>{money(b.balance.paid_minor)}</td></tr>
              <tr><td>Balance:</td><td>{money(b.balance.balance_minor)}</td></tr>
            </tbody>
          </table>
        </section>

        {/* ── Payment History (collapsible) ───────────────────────────────── */}
        <CollapsibleSection title="Payment History" count={`${b.payments.length} payments`}>
          {b.payments.length === 0 ? (
            <p className={styles.empty}>No payments recorded.</p>
          ) : (
            <ul className={styles.items}>
              {b.payments.map((p) => {
                const canCorrect = may.pay && p.active && !p.verification;
                const isEditing = editingPaymentId === p.id;
                return (
                  <li key={p.id} className={styles.item} style={{ flexWrap: 'wrap' }}>
                    <span className={`${styles.itemName} ${p.active ? '' : styles.withdrawn}`}>
                      {formatDateTime(p.paid_at, tz)}
                      {p.kind ? ` · ${PAYMENT_KIND_LABEL[p.kind]}` : ''}
                      {p.method ? ` · ${p.method}` : ''}
                      {p.reverses_id ? ' · Correction' : ''}
                      {p.reversed_by_id ? ' · Corrected' : ''}
                    </span>
                    <span className={styles.money}>{formatMinor(p.amount_minor, p.currency, 'en-IN')}</span>
                    {p.verification ? (
                      <span className={`${styles.badge} ${styles.badgePaid}`}>Verified</span>
                    ) : may.verify && p.active && user?.id !== p.actor_user_id ? (
                      <button type="button" className={styles.action} disabled={busy}
                        aria-label={`Verify payment of ${formatMinor(p.amount_minor, p.currency, 'en-IN')}`}
                        onClick={() => void run(() => banquetApi.verifyPayment(ctx!, p.id), 'Payment verified.')}>
                        Verify
                      </button>
                    ) : p.active ? (
                      <span className={styles.badge}>Not verified</span>
                    ) : null}
                    {canCorrect && !isEditing ? (
                      <button type="button" className={styles.action} disabled={busy}
                        aria-label={`Edit payment of ${formatMinor(p.amount_minor, p.currency, 'en-IN')}`}
                        onClick={() => {
                          setEditingPaymentId(p.id);
                          setEditAmount((p.amount_minor / 10 ** minorUnitDigits(p.currency)).toFixed(minorUnitDigits(p.currency)));
                          setEditMethod(p.method ?? '');
                        }}>
                        Edit
                      </button>
                    ) : null}
                    {isEditing ? (
                      <form
                        style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!editValid || editMinor === null) return;
                          void run(async () => {
                            await banquetApi.updatePayment(ctx!, b.id, p.id, {
                              amount_minor: editMinor,
                              ...(editMethod.trim() ? { method: editMethod.trim() } : {}),
                            });
                            setEditingPaymentId(null);
                          }, 'Payment corrected.');
                        }}
                      >
                        <label className="sr-only" htmlFor="ed-correct-amount">Corrected amount ({b.currency})</label>
                        <input id="ed-correct-amount" className={formStyles.paymentEntryInput} inputMode="decimal"
                          placeholder="Amount" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                        <label className="sr-only" htmlFor="ed-correct-method">Method</label>
                        <input id="ed-correct-method" className={formStyles.paymentEntryInput} placeholder="Method (optional)"
                          value={editMethod} onChange={(e) => setEditMethod(e.target.value)} style={{ maxWidth: 130 }} />
                        <button type="submit" className={styles.action} disabled={busy || !editValid}>Save</button>
                        <button type="button" className={styles.action} onClick={() => setEditingPaymentId(null)}>Cancel</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className={styles.hint} style={{ marginTop: 10 }}>
            An unverified payment can be corrected above. Once verified, it becomes a permanent record — a
            payment is verified by someone other than the person who recorded it.
          </p>
        </CollapsibleSection>

        {/* ── Admin Discount ───────────────────────────────────────────────── */}
        {alterable && (canAdminDiscount || canPerHeadDiscount) ? (
          <section className={formStyles.section} style={{ background: '#fffde7', borderColor: '#f9e68c' }}>
            <h2 className={formStyles.sectionTitle} style={{ color: '#c99a1f', marginBottom: 12 }}>Admin Discount</h2>
            <div className={styles.methodToggle} style={{ marginBottom: 12 }}>
              {canAdminDiscount ? (
                <button type="button"
                  className={`${styles.methodPill} ${discountMode === 'amount' ? styles.methodPillActive : ''}`}
                  style={discountMode === 'amount' ? { background: '#c99a1f', color: '#fff', borderColor: '#c99a1f' } : {}}
                  onClick={() => { setDiscountMode('amount'); setDiscountInput(''); }}>
                  Amount (₹)
                </button>
              ) : null}
              {canAdminDiscount ? (
                <button type="button"
                  className={`${styles.methodPill} ${discountMode === 'percentage' ? styles.methodPillActive : ''}`}
                  style={discountMode === 'percentage' ? { background: '#c99a1f', color: '#fff', borderColor: '#c99a1f' } : {}}
                  onClick={() => { setDiscountMode('percentage'); setDiscountInput(''); }}>
                  Percentage (%)
                </button>
              ) : null}
              {canPerHeadDiscount ? (
                <button type="button"
                  className={`${styles.methodPill} ${discountMode === 'per_head' ? styles.methodPillActive : ''}`}
                  style={discountMode === 'per_head' ? { background: '#c99a1f', color: '#fff', borderColor: '#c99a1f' } : {}}
                  onClick={() => { setDiscountMode('per_head'); setDiscountInput(''); }}>
                  Per Head (₹)
                </button>
              ) : null}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!discountValid || discountMinor === null) return;
              void run(async () => {
                await banquetApi.addAdjustment(ctx!, b.id, { kind: discountKind, description: discountDescription, amount_minor: discountMinor });
                setDiscountInput('');
              }, 'Discount applied.');
            }}>
              <div className={formStyles.fieldGroup}>
                <label className={formStyles.fieldLabel} htmlFor="ed-discount-amount">
                  {discountMode === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
                </label>
                <input id="ed-discount-amount" className={formStyles.input}
                  placeholder={discountMode === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
                  inputMode="decimal" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
              </div>
              <div className={styles.actions} style={{ marginTop: 'var(--gap)' }}>
                <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy || !discountValid}>Apply Discount</button>
              </div>
            </form>
            {b.adjustments.filter((a) => a.kind !== 'EXTRA_CHARGE' && a.active).length > 0 ? (
              <ul className={styles.items} style={{ marginTop: 10 }}>
                {b.adjustments.filter((a) => a.kind !== 'EXTRA_CHARGE').map((a) => (
                  <li key={a.id} className={styles.item}>
                    <span className={`${styles.itemName} ${a.active ? '' : styles.withdrawn}`}>
                      {ADJUSTMENT_LABEL[a.kind]} · {a.description}
                    </span>
                    <span className={`${styles.money} ${styles.discount}`}>&minus;{money(a.amount_minor)}</span>
                    {a.active && can(ADJUSTMENT_PERMISSION[a.kind]) ? (
                      <button type="button" className={styles.action} disabled={busy}
                        aria-label={`Withdraw ${a.description}`}
                        onClick={() => void run(() => banquetApi.reverseAdjustment(ctx!, b.id, a.id), 'Discount withdrawn.')}>
                        Withdraw
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* ── Extra Charges ────────────────────────────────────────────────── */}
        {alterable && permittedKinds.includes('EXTRA_CHARGE') ? (
          <section className={formStyles.section} style={{ background: '#fce4ec', borderColor: '#f8bbd0' }}>
            <CollapsibleSection title="Extra Charges" icon={<AppIcon name="chevronDown" size={18} />} color="#c62828">
              <form onSubmit={(e) => { e.preventDefault(); if (line.kind !== 'EXTRA_CHARGE' || !line.description.trim() || lineMinor === null || lineMinor <= 0) return; void run(async () => { await banquetApi.addAdjustment(ctx!, b.id, { kind: 'EXTRA_CHARGE', description: line.description.trim(), amount_minor: lineMinor }); setLine({ kind: '', description: '', amount: '' }); }, 'Charge added.'); }}>
                <div className={formStyles.paymentEntryRow}>
                  <label className="sr-only" htmlFor="ed-charge-title">Title</label>
                  <input id="ed-charge-title" className={formStyles.paymentEntryInput} placeholder="Title" maxLength={200}
                    value={line.kind === 'EXTRA_CHARGE' ? line.description : ''}
                    onChange={(e) => setLine({ kind: 'EXTRA_CHARGE', description: e.target.value, amount: line.kind === 'EXTRA_CHARGE' ? line.amount : '' })}
                    onFocus={() => { if (line.kind !== 'EXTRA_CHARGE') setLine({ kind: 'EXTRA_CHARGE', description: '', amount: '' }); }} />
                  <label className="sr-only" htmlFor="ed-charge-amount">Amount</label>
                  <input id="ed-charge-amount" className={formStyles.paymentEntryInput} placeholder="₹" inputMode="decimal" style={{ maxWidth: 100 }}
                    value={line.kind === 'EXTRA_CHARGE' ? line.amount : ''}
                    onChange={(e) => setLine({ kind: 'EXTRA_CHARGE', description: line.description, amount: e.target.value })} />
                  <button type="submit" className={formStyles.paymentEntryAdd} disabled={busy} aria-label="Add charge">
                    <AppIcon name="plus" size={20} />
                  </button>
                </div>
              </form>
              {b.adjustments.filter((a) => a.kind === 'EXTRA_CHARGE').length > 0 ? (
                <ul className={styles.items} style={{ marginTop: 10 }}>
                  {b.adjustments.filter((a) => a.kind === 'EXTRA_CHARGE').map((a) => (
                    <li key={a.id} className={styles.item}>
                      <span className={`${styles.itemName} ${a.active ? '' : styles.withdrawn}`}>{a.description}</span>
                      <span className={styles.money}>+{money(a.amount_minor)}</span>
                      {a.active && can(ADJUSTMENT_PERMISSION[a.kind]) ? (
                        <button type="button" className={styles.action} disabled={busy}
                          aria-label={`Withdraw ${a.description}`}
                          onClick={() => void run(() => banquetApi.reverseAdjustment(ctx!, b.id, a.id), 'Charge withdrawn.')}>
                          Withdraw
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CollapsibleSection>
          </section>
        ) : null}

        {/* ── Add New Payment ──────────────────────────────────────────────── */}
        {may.pay && !b.balance.fully_paid ? (
          <section className={formStyles.section} style={{ background: '#e8f5e9', borderColor: '#a5d6a7' }}>
            <h2 className={formStyles.sectionTitle} style={{ color: '#2e7d32', marginBottom: 12 }}>Add New Payment</h2>
            {pendingPayment ? (
              <div className={formStyles.paymentEntryRow} style={{ marginBottom: 12 }}>
                <span style={{ flex: 1 }}>
                  {money(pendingPayment.amount_minor)}{pendingPayment.method ? ` · ${pendingPayment.method}` : ''}
                  {' · '}pending — tap Update Booking below to record it
                </span>
                <button type="button" className={formStyles.photoRemove} aria-label="Remove pending payment"
                  onClick={() => setPendingPayment(null)}>
                  &times;
                </button>
              </div>
            ) : null}
            <form onSubmit={(e) => {
              e.preventDefault();
              if (payMinor === null) return;
              setPendingPayment({ amount_minor: payMinor, method: method.trim() });
              setAmount('');
              setMethod('');
            }}>
              <div className={formStyles.paymentEntryFields}>
                <div className={formStyles.paymentEntryRow}>
                  <label className="sr-only" htmlFor="ed-pay-amount">Amount ({b.currency})</label>
                  <input id="ed-pay-amount" className={formStyles.paymentEntryInput} placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <label className="sr-only" htmlFor="ed-pay-method">Method</label>
                  <select id="ed-pay-method" className={formStyles.paymentEntryInput} style={{ maxWidth: 130 }} value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="">Cash</option>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
                <div className={formStyles.paymentEntryRow}>
                  <button type="submit" className={formStyles.paymentEntryAdd} disabled={busy || !payValid} style={{ marginLeft: 'auto' }} aria-label="Stage payment">
                    <AppIcon name="plus" size={20} />
                  </button>
                </div>
              </div>
              {amount && payMinor === null ? <p className={styles.hint}>Enter a plain amount, e.g. 25000.00</p> : null}
              {overBalance ? <p className={styles.hint}>That is more than the outstanding balance.</p> : null}
            </form>
          </section>
        ) : null}

        {/* ── Additional Information ──────────────────────────────────────── */}
        <CollapsibleSection title="Additional Information" icon={<span style={{ color: '#c62828' }}>+</span>}>
          <div className={formStyles.fieldGroup}>
            <div className={formStyles.field}>
              <label className={formStyles.fieldLabel} htmlFor="ed-comments"><AppIcon name="ticket" size={16} /> Comments</label>
              <textarea id="ed-comments" className={formStyles.input} style={{ minHeight: 80, resize: 'vertical', padding: 12 }}
                placeholder="Enter comments" value={plan.setup_notes}
                onChange={(e) => setPlan({ ...plan, setup_notes: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.fieldLabel} htmlFor="ed-callback-time"><AppIcon name="clock" size={16} /> Callback Time</label>
              <input id="ed-callback-time" type="datetime-local" className={formStyles.input} value={plan.service_at}
                onChange={(e) => setPlan({ ...plan, service_at: e.target.value })} />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.fieldLabel} htmlFor="ed-event-mgmt"><AppIcon name="building" size={16} /> Event Management (Optional)</label>
              <input id="ed-event-mgmt" className={formStyles.input} placeholder="Enter event management (optional)" value={plan.kitchen_notes}
                onChange={(e) => setPlan({ ...plan, kitchen_notes: e.target.value })} />
            </div>
          </div>
          {may.plan ? (
            <div className={styles.actions} style={{ marginTop: 'var(--gap)' }}>
              <button type="button" className={`${styles.action} ${styles.primary}`} disabled={busy}
                onClick={() => {
                  const serviceAt = plan.service_at ? branchLocalToInstant(plan.service_at, tz) : null;
                  if (plan.service_at && !serviceAt) { setActionError('Enter a valid callback time.'); return; }
                  void run(() => banquetApi.saveEventPlan(ctx!, b.id, {
                    service_at: serviceAt ? serviceAt.toISOString() : null,
                    setup_notes: plan.setup_notes.trim() || null,
                    kitchen_notes: plan.kitchen_notes.trim() || null,
                  }), 'Additional info saved.');
                }}>
                Save
              </button>
            </div>
          ) : null}
        </CollapsibleSection>

        {/* ── Live kitchen ordering ───────────────────────────────────────── */}
        {b.status === 'CONFIRMED' || (plateRequests?.length ?? 0) > 0 ? (
          <section className={formStyles.section}>
            <div className={formStyles.sectionHead}>
              <AppIcon name="fork" size={20} />
              <h2 className={formStyles.sectionTitle}>Live kitchen ordering</h2>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: '0 0 12px' }}>
              Send extra items straight to the chef during the event
            </p>
            {kitchenLive ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'color-mix(in srgb, var(--color-success) 12%, var(--color-surface))', borderRadius: 14, marginBottom: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-success)', flex: 'none' }} />
                <div>
                  <strong>Session is live &mdash; ordering open</strong>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>All day today</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'var(--color-surface-muted)', borderRadius: 14, marginBottom: 12 }}>
                <AppIcon name="clock" size={20} />
                <div>
                  <strong>Outside session window</strong>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    Orders unlock on {formatDateTime(b.starts_at, tz).split(',')[0]}.
                  </p>
                </div>
              </div>
            )}
            {platesError ? <p role="alert" className={styles.error}>{platesError}</p> : null}
            {plateRequests && plateRequests.length > 0 ? (
              <ul className={styles.items} aria-label="Plate requests for this booking">
                {plateRequests.map((p) => (
                  <li key={p.id} className={styles.item}>
                    <span className={styles.itemName}>
                      {p.plates} × {p.item.name}
                      <span className={styles.meta}> · {formatDateTime(p.requested_at, tz)} · {p.requested_by.name}{p.note ? ` · "${p.note}"` : ''}{p.rejection_reason ? ` · ${p.rejection_reason}` : ''}</span>
                    </span>
                    <span className={styles.badge}>{PLATE_STATUS_LABEL[p.status]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {may.requestPlates && b.status === 'CONFIRMED' && b.items.length > 0 ? (
              <form onSubmit={(e) => { e.preventDefault(); if (!plateValid) return; const note = plateForm.note.trim(); void run(async () => { await banquetApi.requestPlates(ctx!, b.id, { item_id: plateForm.item_id, plates: platesCount, ...(note ? { note } : {}) }); setPlateForm({ item_id: '', plates: '', note: '' }); setPlatesNonce((n) => n + 1); }, 'Plate request sent to the kitchen.'); }}>
                <div className={formStyles.fieldGroup}>
                  <label className="sr-only" htmlFor="ed-plate-dish">Dish</label>
                  <select id="ed-plate-dish" className={formStyles.select} value={plateForm.item_id} onChange={(e) => setPlateForm({ ...plateForm, item_id: e.target.value })}>
                    <option value="">Choose a dish</option>
                    {b.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <div className={formStyles.paymentEntryRow}>
                    <label className="sr-only" htmlFor="ed-plate-count">Plates</label>
                    <input id="ed-plate-count" className={formStyles.paymentEntryInput} placeholder="Plates" inputMode="numeric" value={plateForm.plates} onChange={(e) => setPlateForm({ ...plateForm, plates: e.target.value })} />
                    <label className="sr-only" htmlFor="ed-plate-note">Note (optional)</label>
                    <input id="ed-plate-note" className={formStyles.paymentEntryInput} placeholder="Note (optional)" maxLength={200} value={plateForm.note} onChange={(e) => setPlateForm({ ...plateForm, note: e.target.value })} />
                  </div>
                </div>
                <button type="submit" className={formStyles.confirmBtn} disabled={busy || !plateValid} style={{ marginTop: 12, opacity: kitchenLive ? 1 : 0.5 }}>
                  Place Kitchen Order
                </button>
              </form>
            ) : (
              <button type="button" className={formStyles.confirmBtn} disabled style={{ opacity: 0.5 }}>
                Place Kitchen Order
              </button>
            )}
          </section>
        ) : null}

        {/* ── Reference Photos ─────────────────────────────────────────────── */}
        <section className={formStyles.section}>
          <div className={formStyles.photosHead}>
            <span className={formStyles.photosIcon}><AppIcon name="calendar" size={20} /></span>
            <h2 className={formStyles.photosTitle}>Reference Photos ({photos.length}/5)</h2>
            <button type="button" className={formStyles.photosAdd} aria-label="Add photo">
              <AppIcon name="plusCircle" size={24} />
            </button>
          </div>
          {photos.length > 0 ? (
            <div className={formStyles.photosGrid}>
              {photos.map((p) => <PhotoThumb key={p.id} bookingId={bookingId} photo={p} />)}
            </div>
          ) : (
            <div className={formStyles.photosEmpty}>
              <AppIcon name="calendar" size={40} />
              <span>No photos attached</span>
              <span>Tap + to add photos (up to 5)</span>
            </div>
          )}
        </section>

        {/* ── Menu Selection ───────────────────────────────────────────────── */}
        <section className={formStyles.section}>
          <div className={formStyles.menuHead}>
            <span className={formStyles.menuIcon}><AppIcon name="fork" size={20} /></span>
            <h2 className={formStyles.menuTitle}>Menu Selection</h2>
            <Link href="/banquet/catalog" className={formStyles.menuSetup}>Menu Setup</Link>
          </div>
          <label className="sr-only" htmlFor="ed-package">Menu</label>
          <select id="ed-package" className={formStyles.select} value={packageId} disabled={!alterable}
            onChange={(e) => setPackageId(e.target.value)}>
            <option value="">No package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {formatMinor(p.price_per_guest_minor, p.currency)}/guest</option>
            ))}
          </select>
          {packageId !== (b.package_id ?? '') ? (
            <p className={styles.hint}>Menu change takes effect when you tap Update Booking below.</p>
          ) : null}
          {b.items.length > 0 ? (
            <ul className={styles.items} style={{ marginTop: 12 }}>
              {b.items.map((i) => (
                <li key={i.id} className={styles.item}>
                  <span className={styles.itemName}>{i.name}</span>
                  <span className={styles.badge}>{KDS_STATUS_LABEL[i.kds_status]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* ── History ──────────────────────────────────────────────────────── */}
        <RecordHistory entityType="BANQUET_BOOKING" entityId={b.id} />
      </div>

      {picker === 'move' && ctx ? (
        <SlotPicker
          date={instantToBranchLocal(new Date(selStartsAt), tz).slice(0, 10)}
          tz={tz}
          ctx={ctx}
          bookingId={b.id}
          title="Move to"
          onSelect={(sel) => {
            setPicker(null);
            setHallSel(sel);
            setNotice('New date and slot chosen — tap Update Booking to move the booking.');
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'add' && ctx && b.customer ? (
        <SlotPicker
          date={instantToBranchLocal(new Date(b.starts_at), tz).slice(0, 10)}
          tz={tz}
          ctx={ctx}
          bookingId=""
          sameDayOnly
          title="Add another slot for this day"
          onSelect={(sel) => {
            setPicker(null);
            setAddingSlot(true);
            setActionError(null);
            void (async () => {
              try {
                // A separate booking — its own bill and payments — pre-filled from this one.
                const created = await banquetApi.createBooking(ctx, {
                  customer_id: b.customer!.id,
                  hall_id: sel.hall_id,
                  starts_at: sel.starts_at,
                  ends_at: sel.ends_at,
                  guest_count: b.guest_count,
                  ...(b.extra_pax > 0 ? { extra_pax: b.extra_pax } : {}),
                  ...(b.package_id ? { package_id: b.package_id } : {}),
                  ...(b.gst_rate_bps === 0 ? { apply_gst: false } : {}),
                });
                router.push(`/banquet/${created.id}/edit`);
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Could not add the slot');
                setAddingSlot(false);
              }
            })();
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      <div className={formStyles.actions}>
        <button type="button" className={formStyles.confirmBtn} disabled={busy || !canSave} onClick={() => void saveAll()}>
          Update Booking
        </button>
        {deletable && !deleteOpen ? (
          <button type="button" className={`${styles.action} ${styles.danger}`} disabled={busy}
            onClick={() => setDeleteOpen(true)}>
            Delete booking
          </button>
        ) : null}
      </div>

      {deleteOpen && deletable ? (
        <div role="alertdialog" aria-label="Delete this booking?" className={styles.form}>
          <p>
            <strong>Delete this booking permanently?</strong>{' '}
            {b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? 'The hall will be freed. ' : ''}
            The booking{b.payments.length > 0 ? ', its payment history' : ''} and its menu will be removed.
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

      {leaveOpen ? (
        <div className={formStyles.leaveBackdrop}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="leave-message" className={formStyles.leaveDialog}>
            <p id="leave-message">
              You are about to leave this page. Do you want to discard the changes or save it?
            </p>
            <div className={formStyles.leaveActions}>
              <button type="button" className={styles.action} onClick={() => router.push(backHref)}>
                Discard
              </button>
              <button type="button" className={`${styles.action} ${styles.primary}`} onClick={() => void saveAndLeave()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
