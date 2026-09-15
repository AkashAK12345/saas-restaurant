'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor } from '@/lib/banquet/money';
import { useNow } from '@/lib/queue/use-now';
import { formatDateTime, formatTime } from '@/lib/format/datetime';
import { ADJUSTMENT_LABEL, PAYMENT_KIND_LABEL, type BanquetBill } from '@/lib/banquet/types';
import print from '@/components/banquet/banquet-print.module.css';
import styles from '@/components/banquet/banquet.module.css';

const percent = (bps: number) => `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/**
 * The printable banquet bill. Every figure comes from the server's invoice —
 * this page adds nothing up itself — and the branch's GSTIN and FSSAI licence
 * come from the branch record. A draft prints as a quotation, never as a bill.
 */
export default function BanquetBillPage() {
  const params = useParams<{ id: string }>();
  const { selectedCompanyId, selectedBranchId } = useAppContext();
  const now = useNow(60_000);
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const [bill, setBill] = useState<BanquetBill | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await banquetApi.getBill(ctx, params.id);
        if (!cancelled) setBill(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the bill');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, params.id]);

  if (error) {
    return (
      <div role="alert" className={styles.error}>
        <p>{error}</p>
        <Link href={`/banquet/${params.id}`} className={styles.link}>
          Back to the booking
        </Link>
      </div>
    );
  }
  if (!bill) {
    return (
      <p role="status" aria-live="polite">
        Loading bill…
      </p>
    );
  }

  const { booking: b, branch } = bill;
  const tz = branch.timezone;
  const inv = b.invoice;
  const money = (minor: number) => formatMinor(minor, b.currency, 'en-IN');
  const title =
    b.status === 'DRAFT' ? 'QUOTATION — NOT CONFIRMED' : b.status === 'CANCELLED' ? 'CANCELLED BOOKING' : 'BANQUET BILL';
  const lines = b.adjustments.filter((a) => a.active);

  return (
    <>
      <div className={print.toolbar}>
        <Link href={`/banquet/${b.id}`} className={styles.link}>
          ← Booking
        </Link>
        <span className={styles.spacer} />
        <button type="button" className={`${styles.action} ${styles.primary}`} onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className={print.sheet} aria-label="Bill">
        <h1 className={print.heading}>{branch.name}</h1>
        {branch.gstin ? <p className={print.muted}>GSTIN: {branch.gstin}</p> : null}
        {branch.fssai_license ? <p className={print.muted}>FSSAI Lic. No.: {branch.fssai_license}</p> : null}
        <p className={print.banner}>{title}</p>

        <div className={print.meta}>
          <p className={print.muted}>Reference: {b.id.slice(0, 8).toUpperCase()}</p>
          <p className={print.muted}>Printed: {formatDateTime(new Date(now), tz)}</p>
          <p className={print.muted}>Customer: {b.customer?.name ?? '—'}</p>
          <p className={print.muted}>Hall: {b.hall_name}</p>
          <p className={print.muted}>
            Event: {formatDateTime(b.starts_at, tz)} – {formatTime(b.ends_at, tz)}
          </p>
          <p className={print.muted}>
            Guests: {b.guest_count}
            {b.extra_pax > 0 ? ` + ${b.extra_pax} extra` : ''}
          </p>
        </div>

        <table className={print.table}>
          <thead>
            <tr>
              <th>Description</th>
              <th className={print.num}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {b.package_name} · {b.guest_count} × {money(b.price_per_guest_minor)}
              </td>
              <td className={print.num}>{money(inv.base_minor)}</td>
            </tr>
            {inv.extra_pax_minor > 0 ? (
              <tr>
                <td>
                  Extra pax · {b.extra_pax} × {money(b.price_per_guest_minor)}
                </td>
                <td className={print.num}>{money(inv.extra_pax_minor)}</td>
              </tr>
            ) : null}
            {lines.map((a) => (
              <tr key={a.id}>
                <td>
                  {ADJUSTMENT_LABEL[a.kind]} · {a.description}
                  {a.kind === 'PER_HEAD_DISCOUNT' ? ` (${money(a.amount_minor)} per plate)` : ''}
                </td>
                <td className={print.num}>
                  {a.kind === 'EXTRA_CHARGE' ? money(a.amount_minor) : a.kind === 'PER_HEAD_DISCOUNT' ? '' : `−${money(a.amount_minor)}`}
                </td>
              </tr>
            ))}
            {inv.per_head_discount_minor > 0 ? (
              <tr>
                <td>Per-head discounts · {b.guest_count + b.extra_pax} plates</td>
                <td className={print.num}>−{money(inv.per_head_discount_minor)}</td>
              </tr>
            ) : null}
            <tr>
              <td>Taxable value</td>
              <td className={print.num}>{money(inv.taxable_minor)}</td>
            </tr>
            {inv.gst_rate_bps > 0 ? (
              <>
                <tr>
                  <td>CGST @ {percent(inv.gst_rate_bps / 2)}</td>
                  <td className={print.num}>{money(inv.cgst_minor)}</td>
                </tr>
                <tr>
                  <td>SGST @ {percent(inv.gst_rate_bps / 2)}</td>
                  <td className={print.num}>{money(inv.sgst_minor)}</td>
                </tr>
              </>
            ) : null}
            <tr className={print.total}>
              <td>Total</td>
              <td className={print.num}>{money(inv.total_minor)}</td>
            </tr>
            <tr>
              <td>Paid</td>
              <td className={print.num}>{money(b.balance.paid_minor)}</td>
            </tr>
            <tr className={print.total}>
              <td>Balance due</td>
              <td className={print.num}>{money(b.balance.balance_minor)}</td>
            </tr>
          </tbody>
        </table>

        {b.payments.length > 0 ? (
          <table className={print.table}>
            <thead>
              <tr>
                <th>Payment date</th>
                <th>Stage</th>
                <th>Method</th>
                <th className={print.num}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateTime(p.paid_at, tz)}</td>
                  <td>{p.kind ? PAYMENT_KIND_LABEL[p.kind] : '—'}</td>
                  <td>{p.method ?? '—'}</td>
                  <td className={print.num}>{formatMinor(p.amount_minor, p.currency, 'en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <p className={print.muted}>
          {inv.gst_rate_bps > 0 ? 'GST shown as CGST and SGST.' : 'No GST charged on this booking.'} Amounts in{' '}
          {b.currency}.
        </p>

        {branch.banquet_terms ? (
          <section aria-label="Terms and conditions">
            <h2 className={print.muted}>Terms and conditions</h2>
            <p className={print.muted} style={{ whiteSpace: 'pre-wrap' }}>
              {branch.banquet_terms}
            </p>
          </section>
        ) : null}
      </article>
    </>
  );
}
