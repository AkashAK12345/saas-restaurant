'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import {
  addCalendarDays,
  branchToday,
  deviceTimeZone,
  formatCalendarDate,
  formatTime,
  weekdayOf,
} from '@/lib/format/datetime';
import type {
  Availability,
  BanquetHall,
  DayAvailability,
  SlotAvailability,
} from '@/lib/banquet/types';
import styles from '@/components/banquet/banquet.module.css';

const DAY_LABEL: Record<DayAvailability, string> = {
  available: 'Available',
  partial: 'Partly booked',
  full: 'Fully booked',
};

const SLOT_LABEL: Record<SlotAvailability, string> = {
  available: 'Free',
  tentative: 'Draft enquiry',
  booked: 'Booked',
};

const SPANS = [
  { days: 7, label: 'Week' },
  { days: 31, label: 'Month' },
] as const;

/**
 * Hall × slot × date availability for the branch, in branch-local days.
 *
 * Read-only: it shows what is held and what is only enquired about, and links
 * to the bookings. It reserves nothing — confirming a booking is still where
 * the server decides who gets a hall.
 */
export default function BanquetCalendarPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const [start, setStart] = useState(() => branchToday(tz));
  const [span, setSpan] = useState<number>(7);
  const [hallId, setHallId] = useState('');
  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const end = addCalendarDays(start, span - 1);

  const load = useCallback(async () => {
    if (!ctx) return;
    try {
      const next = await banquetApi.availability(ctx, {
        from: start,
        to: end,
        ...(hallId ? { hall_id: hallId } : {}),
      });
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load availability');
    } finally {
      setLoading(false);
    }
  }, [ctx, start, end, hallId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      const list = await banquetApi.listHalls(ctx).catch(() => null);
      if (!cancelled && list) setHalls(list.data.filter((h) => h.status === 'ACTIVE'));
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const columns = data?.days[0]?.halls ?? [];

  return (
    <>
      <h1>Availability</h1>

      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}

      <div className={styles.bar}>
        <button type="button" className={styles.action} onClick={() => setStart(addCalendarDays(start, -span))}>
          Previous
        </button>
        <button type="button" className={styles.action} onClick={() => setStart(branchToday(tz))}>
          Today
        </button>
        <button type="button" className={styles.action} onClick={() => setStart(addCalendarDays(start, span))}>
          Next
        </button>
        <span className={styles.meta}>
          {formatCalendarDate(start)} – {formatCalendarDate(end)}
        </span>
        <span className={styles.spacer} />
        <div className={styles.tabs} role="group" aria-label="Range">
          {SPANS.map((s) => (
            <button
              key={s.days}
              type="button"
              className={`${styles.action} ${span === s.days ? styles.tabOn : ''}`}
              aria-pressed={span === s.days}
              onClick={() => setSpan(s.days)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select
          className={styles.select}
          style={{ width: 'auto' }}
          value={hallId}
          onChange={(e) => setHallId(e.target.value)}
          aria-label="Show hall"
        >
          <option value="">All active halls</option>
          {halls.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.legend}>
        <span className={`${styles.slot} ${styles.slotavailable}`}>Free</span>
        <span className={`${styles.slot} ${styles.slottentative}`}>Draft enquiry (not held)</span>
        <span className={`${styles.slot} ${styles.slotbooked}`}>Booked</span>
        <span className={styles.meta}>Days are branch-local ({tz}).</span>
      </div>

      {loading && !data ? (
        <p role="status" aria-live="polite">
          Loading availability…
        </p>
      ) : !data ? null : columns.length === 0 ? (
        <p className={styles.empty}>No active halls. Add one under Halls &amp; packages.</p>
      ) : (
        <div className={styles.calendarWrap}>
          <table className={styles.calendar}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {columns.map((h) => (
                  <th key={h.hall_id} scope="col">
                    {h.hall_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    {weekdayOf(day.date)} {formatCalendarDate(day.date)}
                  </th>
                  {day.halls.map((h) => (
                    <td key={h.hall_id}>
                      <span className={styles[`day${h.state}`]}>{DAY_LABEL[h.state]}</span>
                      {h.slots.length > 0 ? (
                        <ul className={styles.slots}>
                          {h.slots.map((s) => (
                            <li key={s.slot_id} className={`${styles.slot} ${styles[`slot${s.state}`]}`}>
                              {s.booking_ids[0] ? (
                                <Link href={`/banquet/${s.booking_ids[0]}`}>
                                  {s.name} · {SLOT_LABEL[s.state]}
                                </Link>
                              ) : (
                                <>
                                  {s.name} {formatTime(s.starts_at, tz)} · {SLOT_LABEL[s.state]}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className={styles.slots}>
                          {h.confirmed_booking_ids.map((id, i) => (
                            <li key={id} className={`${styles.slot} ${styles.slotbooked}`}>
                              <Link href={`/banquet/${id}`}>Booked event {i + 1}</Link>
                            </li>
                          ))}
                          {h.draft_booking_ids.map((id, i) => (
                            <li key={id} className={`${styles.slot} ${styles.slottentative}`}>
                              <Link href={`/banquet/${id}`}>Draft enquiry {i + 1}</Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
