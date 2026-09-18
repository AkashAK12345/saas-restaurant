'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import {
  MONTH_LONG,
  MONTH_SHORT,
  addCalendarDays,
  addCalendarMonths,
  branchToday,
  daysInMonth,
  deviceTimeZone,
  formatTime,
  monthEnd,
  monthStart,
} from '@/lib/format/datetime';
import type { ChefCalendarBooking } from '@/lib/banquet/types';
import { WEEKDAY_LONG, WEEKDAY_SHORT, dayNum, shortLabel, weekday } from '@/lib/banquet/chef-dates';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import styles from '@/components/banquet/chef.module.css';

type View = 'week' | 'month';

/**
 * The chef display: every confirmed event for a week (a column per day,
 * starting today) or a month, with what the kitchen needs — plates, hall,
 * slot — and the menu behind "View details". No money is ever shown here.
 */
export default function BanquetChefPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const today = branchToday(tz);
  // View and day live in the address, so returning from an event's details
  // lands on the same week or month.
  const router = useRouter();
  const search = useSearchParams();
  const initialView: View = search.get('view') === 'month' ? 'month' : 'week';
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(search.get('date') ?? '') ? search.get('date')! : today;
  const [view, setView] = useState<View>(initialView);
  // The week's first day, or any day in the month shown.
  const [anchor, setAnchor] = useState(initialDate);
  const [selectedDay, setSelectedDay] = useState(initialDate);
  const [bookings, setBookings] = useState<ChefCalendarBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const here = `/banquet/kitchen?view=${view}&date=${view === 'week' ? anchor : selectedDay}`;
  useEffect(() => {
    router.replace(here, { scroll: false });
  }, [router, here]);

  const range = useMemo(
    () =>
      view === 'week'
        ? { from: anchor, to: addCalendarDays(anchor, 6) }
        : { from: monthStart(anchor), to: monthEnd(anchor) },
    [view, anchor],
  );

  const load = useCallback(async () => {
    if (!ctx) return;
    try {
      const res = await banquetApi.chefCalendar(ctx, range);
      setBookings(res.bookings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the events');
    }
  }, [ctx, range]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect.
    void (async () => {
      await load();
    })();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, ChefCalendarBooking[]>();
    for (const b of bookings ?? []) map.set(b.date, [...(map.get(b.date) ?? []), b]);
    return map;
  }, [bookings]);

  const switchView = (next: View) => {
    setView(next);
    setAnchor(today);
    setSelectedDay(today);
  };
  const step = (direction: -1 | 1) => {
    if (view === 'week') {
      setAnchor((a) => addCalendarDays(a, direction * 7));
    } else {
      const next = addCalendarMonths(anchor, direction);
      setAnchor(next);
      setSelectedDay(next.slice(0, 7) === today.slice(0, 7) ? today : next);
    }
  };
  const goToday = () => {
    setAnchor(today);
    setSelectedDay(today);
  };

  const bandLabel =
    view === 'week'
      ? `${shortLabel(range.from)} - ${shortLabel(range.to)}`
      : `${MONTH_LONG[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  const count = bookings?.length ?? 0;

  const card = (b: ChefCalendarBooking) => (
    <article key={b.id} className={styles.card}>
      <h3 className={styles.cardName}>{b.customer_name ?? 'Event'}</h3>
      <p className={styles.cardLine}>
        <AppIcon name="people" size={15} />
        <span>{b.guest_count} pax</span>
      </p>
      <p className={styles.cardLine}>
        <AppIcon name="pin" size={15} />
        <span>{b.hall_name}</span>
      </p>
      <p className={styles.cardLine}>
        <AppIcon name="clock" size={15} />
        <span>{b.slot_name ?? `${formatTime(b.starts_at, tz)} – ${formatTime(b.ends_at, tz)}`}</span>
      </p>
      <Link
        href={`/banquet/kitchen/${b.id}?back=${encodeURIComponent(here)}`}
        className={styles.details}
        aria-label={`View details for ${b.customer_name ?? 'event'} on ${shortLabel(b.date)}`}
      >
        View details <AppIcon name="chevronRight" size={15} />
      </Link>
    </article>
  );

  const header = <ScreenHeader crumb="Banquet" title="Chef Display" plain />;
  if (!ctx) return header;

  return (
    <>
      {header}

      <div className={styles.band}>
        <AppIcon name="calendar" size={24} />
        <h2 className={styles.bandRange}>{bandLabel}</h2>
        <span className={styles.bandCount}>
          {bookings ? `${count} ${count === 1 ? 'booking' : 'bookings'}` : ''}
        </span>
      </div>

      <div className={styles.controls}>
        <div className={styles.segmented} role="group" aria-label="Calendar view">
          <button type="button" className={styles.segment} aria-pressed={view === 'week'} onClick={() => switchView('week')}>
            Weekly
          </button>
          <button type="button" className={styles.segment} aria-pressed={view === 'month'} onClick={() => switchView('month')}>
            Monthly
          </button>
        </div>
        <div className={styles.nav}>
          <button
            type="button"
            className={`${styles.navButton} ${styles.navPrev}`}
            aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
            onClick={() => step(-1)}
          >
            <AppIcon name="chevronRight" size={16} />
          </button>
          <button type="button" className={styles.navButton} onClick={goToday}>Today</button>
          <button
            type="button"
            className={styles.navButton}
            aria-label={view === 'week' ? 'Next week' : 'Next month'}
            onClick={() => step(1)}
          >
            <AppIcon name="chevronRight" size={16} />
          </button>
        </div>
      </div>

      {error ? <p role="alert" className={styles.error}>{error}</p> : null}

      {!bookings && !error ? (
        <p className={styles.loading}>Loading…</p>
      ) : view === 'week' ? (
        <div className={styles.week}>
          {Array.from({ length: 7 }, (_, i) => {
            const date = addCalendarDays(range.from, i);
            const events = byDay.get(date) ?? [];
            return (
              <section key={date} className={styles.day} aria-label={`${WEEKDAY_LONG[weekday(date)]} ${shortLabel(date)}`}>
                <div className={styles.dayHead} data-today={date === today}>
                  <span className={styles.dayName}>{WEEKDAY_SHORT[weekday(date)]}</span>
                  <span className={styles.dayNum}>{dayNum(date)}</span>
                </div>
                {events.length > 0 ? events.map(card) : <p className={styles.dayEmpty}>No bookings</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className={styles.month}>
          <div className={styles.weekdays} aria-hidden="true">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className={styles.grid}>
            {Array.from({ length: weekday(monthStart(anchor)) }, (_, i) => <span key={`lead-${i}`} />)}
            {Array.from({ length: daysInMonth(anchor) }, (_, i) => {
              const date = `${anchor.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`;
              const n = byDay.get(date)?.length ?? 0;
              return (
                <button
                  key={date}
                  type="button"
                  className={styles.cell}
                  aria-pressed={date === selectedDay}
                  aria-label={`${i + 1} ${MONTH_LONG[Number(date.slice(5, 7)) - 1]}, ${n} ${n === 1 ? 'booking' : 'bookings'}`}
                  data-today={date === today}
                  onClick={() => setSelectedDay(date)}
                >
                  <span className={styles.cellNum}>{i + 1}</span>
                  {n > 0 ? <span className={styles.cellCount}>{n}</span> : <span className={styles.cellCountEmpty} />}
                </button>
              );
            })}
          </div>
          <div className={styles.dayList}>
            <h3 className={styles.dayTitle}>
              {WEEKDAY_LONG[weekday(selectedDay)]}, {dayNum(selectedDay)} {MONTH_SHORT[Number(selectedDay.slice(5, 7)) - 1]}
            </h3>
            {(byDay.get(selectedDay) ?? []).length > 0 ? (
              (byDay.get(selectedDay) ?? []).map(card)
            ) : (
              <p className={styles.monthEmpty}>No bookings</p>
            )}
          </div>
        </div>
      )}

    </>
  );
}

