'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import { deviceTimeZone, formatDateTime, formatTime } from '@/lib/format/datetime';
import type { BanquetBookingDetail } from '@/lib/banquet/types';
import print from '@/components/banquet/banquet-print.module.css';
import styles from '@/components/banquet/banquet.module.css';

/**
 * The kitchen order ticket for one confirmed event: room, plates, service time,
 * kitchen notes and the dishes. It carries NO money and no customer identity —
 * the same rule as the chef display — and says so on its face so it can never
 * be mistaken for a bill.
 */
export default function BanquetKotPage() {
  const params = useParams<{ id: string }>();
  const { selectedCompanyId, selectedBranchId, selectedBranch } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const [booking, setBooking] = useState<BanquetBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await banquetApi.getBooking(ctx, params.id);
        if (!cancelled) setBooking(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the booking');
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
  if (!booking) {
    return (
      <p role="status" aria-live="polite">
        Loading KOT…
      </p>
    );
  }

  const b = booking;
  if (b.status !== 'CONFIRMED' && b.status !== 'COMPLETED') {
    return (
      <div className={styles.empty}>
        <p>A kitchen order ticket is printed only for a confirmed event.</p>
        <Link href={`/banquet/${b.id}`} className={styles.link}>
          Back to the booking
        </Link>
      </div>
    );
  }

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

      <article className={print.sheet} aria-label="Kitchen order ticket">
        <p className={print.banner}>NOT A BILL - KITCHEN ONLY</p>
        <h1 className={print.heading}>KOT · {b.hall_name}</h1>
        <div className={print.meta}>
          <p className={print.muted}>Reference: {b.id.slice(0, 8).toUpperCase()}</p>
          <p className={print.muted}>
            Event: {formatDateTime(b.starts_at, tz)} – {formatTime(b.ends_at, tz)}
          </p>
          <p className={print.muted}>Service: {formatDateTime(b.event_plan?.service_at ?? null, tz)}</p>
          <p className={print.muted}>
            <strong>Plates: {b.guest_count + b.extra_pax}</strong>
          </p>
        </div>
        {b.event_plan?.kitchen_notes ? (
          <p>
            <strong>Kitchen notes:</strong> {b.event_plan.kitchen_notes}
          </p>
        ) : null}
        {b.items.length === 0 ? (
          <p className={print.muted}>This package lists no dishes.</p>
        ) : (
          <ol className={print.kotItems}>
            {b.items.map((i) => (
              <li key={i.id}>{i.name}</li>
            ))}
          </ol>
        )}
      </article>
    </>
  );
}
