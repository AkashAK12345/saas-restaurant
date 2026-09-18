'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi, type BanquetContext } from '@/lib/banquet/api';
import { formatMinor, toMinor } from '@/lib/banquet/money';
import { branchLocalToInstant } from '@/lib/queue/branch-time';
import { addCalendarDays, deviceTimeZone } from '@/lib/format/datetime';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import type { BanquetHall, BanquetPackage } from '@/lib/banquet/types';
import type { Customer } from '@/lib/queue/types';
import chrome from '@/components/app/screen-chrome.module.css';
import styles from '@/components/banquet/booking-form.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date: string) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export default function NewBookingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions, companyPermissions } =
    useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();

  const ctx = useMemo<BanquetContext | null>(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const date = params.get('date') ?? '';
  const slotName = params.get('slot_name') ?? '';
  const startsAtParam = params.get('starts_at') ?? '';
  const endsAtParam = params.get('ends_at') ?? '';

  const [hallId, setHallId] = useState(params.get('hall_id') ?? '');
  const [hallName, setHallName] = useState(params.get('hall_name') ?? '');
  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [pax, setPax] = useState('');
  const [packageId, setPackageId] = useState('');
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(true);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payBillRef, setPayBillRef] = useState('');
  const [payDate, setPayDate] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [pendingPhotos, setPendingPhotos] = useState<{ file: File; preview: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingPayment, setPendingPayment] = useState<{ amount_minor: number; method: string; reference: string } | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      const [p, h] = await Promise.all([
        banquetApi.listPackages(ctx).catch(() => null),
        banquetApi.listHalls(ctx).catch(() => null),
      ]);
      if (cancelled) return;
      if (p) setPackages(p.data.filter((x) => x.status === 'ACTIVE'));
      if (h) setHalls(h.data.filter((x) => x.status === 'ACTIVE'));
    })();
    return () => { cancelled = true; };
  }, [ctx]);

  // Save sits at the bottom of a long form; bring the error banner into view.
  useEffect(() => {
    if (error) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [error]);

  const selectedPkg = packages.find((p) => p.id === packageId) ?? null;
  const guestCount = Number.parseInt(pax, 10) || 0;
  const currency = selectedPkg?.currency ?? 'INR';
  const menuAmount = selectedPkg ? selectedPkg.price_per_guest_minor * guestCount : 0;
  const cgst = Math.round(menuAmount * 0.025);
  const sgst = Math.round(menuAmount * 0.025);
  const finalAmount = menuAmount + cgst + sgst;

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 5 - pendingPhotos.length;
    const toAdd = Array.from(files).slice(0, remaining);
    const newPhotos = toAdd.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPendingPhotos((prev) => [...prev, ...newPhotos]);
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    setPendingPhotos((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const addPayment = () => {
    const minor = toMinor(payAmount, currency);
    if (minor === null || minor < 0) {
      setError('Enter a payment amount — 0 if nothing was collected yet.');
      return;
    }
    setError(null);
    setPendingPayment({ amount_minor: minor, method: payMethod.trim(), reference: payBillRef.trim() });
    setPayAmount('');
    setPayMethod('');
    setPayBillRef('');
  };

  // Clicking + is a convenience, not a requirement — an amount typed but never
  // "added" still counts, so simply filling the field is enough to proceed.
  const rawPayMinor = toMinor(payAmount, currency);
  const effectivePayment =
    pendingPayment ??
    (rawPayMinor !== null && rawPayMinor >= 0
      ? { amount_minor: rawPayMinor, method: payMethod.trim(), reference: payBillRef.trim() }
      : null);

  const submit = async () => {
    if (!ctx) return;
    if (!customerName.trim()) { setError('Customer name is required'); return; }
    if (!phone.trim()) { setError('Phone number is required'); return; }
    if (guestCount < 1) { setError('Number of guests is required'); return; }
    if (!hallId) { setError('No hall selected'); return; }
    if (!effectivePayment) {
      setError('Payment amount is required — enter 0 if nothing was collected yet.');
      return;
    }

    const startsAt = startsAtParam || `${date}T06:00:00.000Z`;
    const endsAt = endsAtParam || `${date}T18:00:00.000Z`;

    setBusy(true);
    setError(null);

    try {
      let customer = await findOrCreateCustomer(ctx, customerName.trim(), phone.trim());

      const body: Parameters<typeof banquetApi.createBooking>[1] = {
        customer_id: customer.id,
        hall_id: hallId,
        starts_at: startsAt,
        ends_at: endsAt,
        guest_count: guestCount,
        ...(packageId ? { package_id: packageId } : {}),
        // Sent with the booking so both succeed or fail together; an advance
        // above zero is what confirms the booking and claims the hall.
        initial_payment: {
          amount_minor: effectivePayment.amount_minor,
          ...(effectivePayment.method ? { method: effectivePayment.method } : {}),
          ...(effectivePayment.reference ? { reference: effectivePayment.reference } : {}),
        },
      };

      const created = await banquetApi.createBooking(ctx, body);

      for (const photo of pendingPhotos) {
        try {
          const base64 = await fileToBase64(photo.file);
          await banquetApi.uploadPhoto(ctx, created.id, {
            data: base64,
            mime_type: photo.file.type || 'image/jpeg',
            file_name: photo.file.name,
          });
        } catch {
          // Best effort — photos are secondary to booking creation
        }
      }

      router.push(`/banquet/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create booking');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHeader crumb="Banquet" title="New Booking" />
      <div className={chrome.content}>
        {error ? (
          <p role="alert" className={chrome.alert}>
            {error}
          </p>
        ) : null}

        {/* Date & hall chips */}
        <div className={styles.section}>
          <div className={styles.chips}>
            {date ? (
              <span className={styles.chip + ' ' + styles.chipDate}>
                <AppIcon name="calendar" size={18} />
                {shortDate(date)}
              </span>
            ) : null}
            <span className={styles.chipIcon}>
              <AppIcon name="calendar" size={18} />
            </span>
            <span className={styles.chipIcon}>
              <AppIcon name="plus" size={18} />
            </span>
          </div>
          <div className={styles.chips} style={{ marginTop: 12 }}>
            {halls.map((h) => (
              <span
                key={h.id}
                className={styles.chip + ' ' + styles.chipHall}
                style={{
                  cursor: 'pointer',
                  opacity: hallId && hallId !== h.id ? 0.45 : 1,
                  outline: hallId === h.id ? '2px solid var(--color-primary)' : 'none',
                }}
                onClick={() => { setHallId(h.id); setHallName(h.name); }}
              >
                <AppIcon name="pin" size={16} />
                {h.name}{hallId === h.id && slotName ? ` - ${slotName}` : ''}
              </span>
            ))}
          </div>
        </div>

        {/* Customer Information */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}>
              <AppIcon name="person" size={22} />
            </span>
            <h2 className={styles.sectionTitle}>Customer Information</h2>
          </div>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                <AppIcon name="personAdd" size={16} />
                Customer Name *
              </label>
              <input
                className={styles.input}
                type="text"
                placeholder="Enter customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                <AppIcon name="phone" size={16} />
                Phone Number *
              </label>
              <input
                className={styles.input}
                type="tel"
                placeholder="Enter phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                <AppIcon name="people" size={16} />
                Number of Guests (PAX) *
              </label>
              <input
                className={styles.input}
                type="number"
                placeholder="Enter number of guests (pax)"
                value={pax}
                onChange={(e) => setPax(e.target.value)}
                min={1}
              />
            </div>
          </div>
        </div>

        {/* Payment Information */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}>
              <AppIcon name="ticket" size={22} />
            </span>
            <h2 className={styles.sectionTitle}>Payment Information</h2>
          </div>
          <table className={styles.paymentTable}>
            <tbody>
              <tr>
                <td>Menu Amount:</td>
                <td>{formatMinor(menuAmount, currency)}</td>
              </tr>
              <tr>
                <td>CGST 2.5%:</td>
                <td>{formatMinor(cgst, currency)}</td>
              </tr>
              <tr>
                <td>SGST 2.5%:</td>
                <td>{formatMinor(sgst, currency)}</td>
              </tr>
              <tr>
                <td><strong>Final Amount:</strong></td>
                <td>{formatMinor(finalAmount, currency)}</td>
              </tr>
              <tr>
                <td>Total Paid:</td>
                <td>{formatMinor(effectivePayment?.amount_minor ?? 0, currency)}</td>
              </tr>
              <tr>
                <td><strong>Balance:</strong></td>
                <td>{formatMinor(finalAmount - (effectivePayment?.amount_minor ?? 0), currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Payment History */}
        <button
          type="button"
          className={`${styles.collapsible} ${paymentHistoryOpen ? styles.collapsibleOpen : ''} ${paymentHistoryOpen ? styles.collapsibleExpanded : ''}`}
          onClick={() => setPaymentHistoryOpen(!paymentHistoryOpen)}
        >
          <AppIcon name="chevronDown" size={18} />
          <span className={styles.collapsibleTitle}>
            <AppIcon name="ticket" size={18} />
            Payment History *
          </span>
          <span className={styles.collapsibleCount}>{pendingPayment ? 1 : 0} payments</span>
        </button>
        {paymentHistoryOpen ? (
          <div className={styles.collapsibleBody}>
            {!pendingPayment ? (
              <p style={{ margin: '0 0 10px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                A payment amount is required — enter 0 below if nothing was collected. Tap + to also record a
                method or bill number.
              </p>
            ) : null}
            {pendingPayment ? (
              <div className={styles.paymentEntryRow} style={{ marginBottom: 12 }}>
                <span style={{ flex: 1 }}>
                  {formatMinor(pendingPayment.amount_minor, currency)}
                  {pendingPayment.method ? ` · ${pendingPayment.method}` : ''}
                  {pendingPayment.reference ? ` · Bill #${pendingPayment.reference}` : ''}
                </span>
                <button
                  type="button"
                  className={styles.photoRemove}
                  aria-label="Remove payment"
                  onClick={() => setPendingPayment(null)}
                >
                  ×
                </button>
              </div>
            ) : null}
            <div className={styles.paymentEntryFields}>
              <div className={styles.paymentEntryRow}>
                <div className={styles.paymentEntryField}>
                  <input
                    className={styles.paymentEntryInput}
                    type="number"
                    placeholder="Amount"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    min={0}
                  />
                </div>
                <div className={styles.paymentEntryField}>
                  <input
                    className={styles.paymentEntryInput}
                    type="text"
                    placeholder="Method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.paymentEntryRow}>
                <div className={styles.paymentEntryField}>
                  <input
                    className={styles.paymentEntryInput}
                    type="text"
                    placeholder="Bill #"
                    value={payBillRef}
                    onChange={(e) => setPayBillRef(e.target.value)}
                  />
                </div>
                <input
                  className={styles.paymentEntryDate}
                  type="text"
                  placeholder="DD/MM"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
                <button type="button" className={styles.paymentEntryAdd} aria-label="Add payment" onClick={addPayment}>
                  <AppIcon name="plus" size={22} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Additional Information */}
        <button
          type="button"
          className={`${styles.collapsible} ${additionalOpen ? styles.collapsibleOpen : ''}`}
          onClick={() => setAdditionalOpen(!additionalOpen)}
        >
          <AppIcon name="chevronRight" size={18} />
          <span className={styles.collapsibleTitle}>
            <AppIcon name="plusCircle" size={18} />
            Additional Information
          </span>
        </button>

        {/* Reference Photos */}
        <div className={styles.section}>
          <div className={styles.photosHead}>
            <span className={styles.photosIcon}>
              <AppIcon name="fullscreen" size={22} />
            </span>
            <h2 className={styles.photosTitle}>Reference Photos ({pendingPhotos.length}/5)</h2>
            {pendingPhotos.length < 5 ? (
              <button type="button" className={styles.photosAdd} aria-label="Add photo" onClick={() => fileInputRef.current?.click()}>
                <AppIcon name="plusCircle" size={24} />
              </button>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />
          {pendingPhotos.length === 0 ? (
            <div className={styles.photosEmpty} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
              <AppIcon name="fullscreen" size={40} />
              <span>No photos attached</span>
              <span>Tap + to add photos (up to 5)</span>
            </div>
          ) : (
            <div className={styles.photosGrid}>
              {pendingPhotos.map((p, i) => (
                <div key={i} className={styles.photoThumb}>
                  <img src={p.preview} alt={p.file.name} />
                  <button type="button" className={styles.photoRemove} aria-label="Remove photo" onClick={() => removePhoto(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Menu Selection */}
        <div className={styles.section}>
          <div className={styles.menuHead}>
            <span className={styles.menuIcon}>
              <AppIcon name="fork" size={22} />
            </span>
            <h2 className={styles.menuTitle}>Menu Selection</h2>
            <Link href="/banquet/catalog" className={styles.menuSetup}>
              <AppIcon name="monitor" size={16} /> Menu Setup
            </Link>
          </div>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <select
                className={styles.select}
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
              >
                <option value="">Select Menu (Optional)</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMinor(p.price_per_guest_minor, p.currency)}/guest
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={styles.addOnButton}>
              <AppIcon name="fork" size={18} />
              +Add On
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={busy || !effectivePayment}
            onClick={() => submit()}
          >
            {busy ? 'Saving…' : 'Save Booking'}
          </button>
        </div>
        {!effectivePayment ? (
          <p style={{ margin: '-8px 0 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Enter a payment amount above (0 if none collected) to continue.
          </p>
        ) : null}
      </div>
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function findOrCreateCustomer(
  ctx: BanquetContext,
  name: string,
  phone: string,
): Promise<{ id: string }> {
  const list = await banquetApi.customers(ctx);
  const existing = list.data.find((c) => c.phone === phone);
  if (existing) {
    // Matched by phone, but the operator may have typed a corrected or
    // updated name for this booking — keep the shared customer record in
    // sync with it rather than silently keeping whatever name was on file.
    if (existing.name !== name) {
      try {
        await banquetApi.updateCustomer(ctx, existing.id, { name });
      } catch {
        // Best effort — the booking still proceeds under the existing record.
      }
    }
    return existing;
  }
  return banquetApi.createCustomer(ctx, { name, phone });
}
