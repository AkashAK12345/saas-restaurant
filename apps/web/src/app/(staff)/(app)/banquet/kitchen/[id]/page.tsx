'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import { deviceTimeZone, formatTime } from '@/lib/format/datetime';
import { KDS_STATUS_LABEL, type ChefCalendarBooking } from '@/lib/banquet/types';
import { fullLabel } from '@/lib/banquet/chef-dates';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import styles from '@/components/banquet/chef.module.css';

/**
 * One event from the chef display, full screen: when, where, for how many,
 * and the menu when one was chosen. Kitchen data only — never money.
 */
export default function ChefEventPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { selectedCompanyId, selectedBranchId, selectedBranch } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  // Back to the same week or month the event was opened from; only ever the chef display.
  const requested = search.get('back') ?? '';
  const backHref = requested.startsWith('/banquet/kitchen?') ? requested : '/banquet/kitchen';

  const [event, setEvent] = useState<ChefCalendarBooking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await banquetApi.chefEvent(ctx, id);
        if (!cancelled) {
          setEvent(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the event');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, id]);

  const title = event?.customer_name ?? 'Event';
  const time = event ? `${formatTime(event.starts_at, tz)} – ${formatTime(event.ends_at, tz)}` : '';

  return (
    <>
      <ScreenHeader
        crumb="Chef Display"
        title={event ? title : 'Event details'}
        plain
        back={{ href: backHref, label: 'Back to Chef Display' }}
      />

      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {!event && !error ? <p className={styles.loading}>Loading…</p> : null}

      {event ? (
        <>
          <div className={styles.band}>
            <AppIcon name="calendar" size={24} />
            <h2 className={styles.bandRange}>{fullLabel(event.date)}</h2>
            {event.slot_name ? <span className={styles.bandCount}>{event.slot_name}</span> : null}
          </div>

          <div className={styles.detail}>
            <section className={styles.detailCard} aria-label="Event">
              <h2 className={styles.detailName}>{title}</h2>
              <p className={styles.cardLine}>
                <AppIcon name="people" size={17} />
                <span>{event.guest_count} pax</span>
              </p>
              <p className={styles.cardLine}>
                <AppIcon name="pin" size={17} />
                <span>{event.hall_name}</span>
              </p>
              <p className={styles.cardLine}>
                <AppIcon name="clock" size={17} />
                <span>{event.slot_name ? `${event.slot_name} · ${time}` : time}</span>
              </p>
              {event.service_at ? (
                <p className={styles.cardLine}>
                  <AppIcon name="fork" size={17} />
                  <span>Service at {formatTime(event.service_at, tz)}</span>
                </p>
              ) : null}
            </section>

            {event.items.length > 0 ? (
              <section className={styles.detailSection}>
                <h3 className={styles.detailSectionTitle}>
                  Menu{event.package_name ? ` — ${event.package_name}` : ''}
                </h3>
                <ul className={styles.menu}>
                  {event.items.map((item) => (
                    <li key={item.id} className={styles.menuItem}>
                      <span>{item.name}</span>
                      <span className={styles.status} data-status={item.kds_status}>
                        {KDS_STATUS_LABEL[item.kds_status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {event.kitchen_notes ? (
              <section className={styles.detailSection}>
                <h3 className={styles.detailSectionTitle}>Kitchen notes</h3>
                <p className={styles.note}>{event.kitchen_notes}</p>
              </section>
            ) : null}

            {event.setup_notes ? (
              <section className={styles.detailSection}>
                <h3 className={styles.detailSectionTitle}>Setup notes</h3>
                <p className={styles.note}>{event.setup_notes}</p>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
