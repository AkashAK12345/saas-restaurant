'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import { addCalendarDays, branchToday, deviceTimeZone, formatTime } from '@/lib/format/datetime';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import type { Availability, AvailabilityHallDay, AvailabilitySlot, BanquetBooking } from '@/lib/banquet/types';
import chrome from '@/components/app/screen-chrome.module.css';
import widgets from '@/components/app/screen-widgets.module.css';
import styles from '@/components/banquet/availability.module.css';

type Kind = 'both' | 'draft' | 'upcoming';
type View = 'calendar' | 'weekly';
type DayState = 'available' | 'partial' | 'full' | 'none';
type SheetFilter = 'both' | 'dinein';

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'both', label: 'Both' },
  { id: 'draft', label: 'Draft' },
  { id: 'upcoming', label: 'Upcoming' },
];

const STATE_LABEL: Record<DayState, string> = {
  available: 'Available',
  partial: 'Partly booked',
  full: 'Fully booked',
  none: 'No halls',
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const PAGE_SIZE = 100;

const dayOf = (date: string) => new Date(`${date}T00:00:00.000Z`);
const weekdayIndex = (date: string) => dayOf(date).getUTCDay();
const startOfWeek = (date: string) => addCalendarDays(date, -weekdayIndex(date));
const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
const addMonths = (date: string, months: number) => {
  const d = dayOf(firstOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const daysInMonth = (date: string) => {
  const d = dayOf(firstOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.getUTCDate();
};
const monthName = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dayOf(date));
const dayNumber = (date: string) => dayOf(date).getUTCDate();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const shortDay = (date: string) => {
  const d = dayOf(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const fullDate = (date: string) => {
  const d = dayOf(date);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

const countsFor = (status: BanquetBooking['status'], kind: Kind) =>
  status === 'DRAFT' ? kind !== 'upcoming' : status === 'CONFIRMED' || status === 'COMPLETED' ? kind !== 'draft' : false;

function hallState(hall: AvailabilityHallDay, kind: Kind): DayState {
  const takesBooked = kind !== 'draft';
  const takesDraft = kind !== 'upcoming';
  if (hall.slots.length > 0) {
    const taken = hall.slots.filter(
      (s) => (s.state === 'booked' && takesBooked) || (s.state === 'tentative' && takesDraft),
    ).length;
    if (taken === 0) return 'available';
    return taken === hall.slots.length ? 'full' : 'partial';
  }
  const bookings =
    (takesBooked ? hall.confirmed_booking_ids.length : 0) + (takesDraft ? hall.draft_booking_ids.length : 0);
  return bookings === 0 ? 'available' : 'partial';
}

function dayState(halls: AvailabilityHallDay[] | undefined, kind: Kind): DayState {
  if (!halls || halls.length === 0) return 'none';
  const states = halls.map((h) => hallState(h, kind));
  if (states.every((s) => s === 'available')) return 'available';
  if (states.every((s) => s === 'full')) return 'full';
  return 'partial';
}

function DaySheet({
  date,
  halls,
  bookings,
  tz,
  onClose,
}: {
  date: string;
  halls: AvailabilityHallDay[];
  bookings: BanquetBooking[];
  tz: string;
  onClose: () => void;
}) {
  const isPast = date < branchToday(tz);
  const [filter, setFilter] = useState<SheetFilter>('both');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (hallId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hallId)) next.delete(hallId);
      else next.add(hallId);
      return next;
    });
  };

  const bookingById = useMemo(() => {
    const map = new Map<string, BanquetBooking>();
    for (const b of bookings) map.set(b.id, b);
    return map;
  }, [bookings]);

  const slotBooking = (slot: AvailabilitySlot): BanquetBooking | undefined => {
    for (const id of slot.booking_ids) {
      const b = bookingById.get(id);
      if (b) return b;
    }
    return undefined;
  };

  const availableCount = (hall: AvailabilityHallDay) =>
    hall.slots.filter((s) => s.state === 'available').length;

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Availability for ${fullDate(date)}`}>
        <div className={styles.sheetHandle} />

        <div className={styles.sheetHeader}>
          <span className={styles.sheetIcon} data-tone="terracotta">
            <AppIcon name="calendar" size={24} />
          </span>
          <h2 className={styles.sheetTitle}>Availability for {fullDate(date)}</h2>
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className={styles.sheetFilters}>
          <button
            type="button"
            className={`${styles.sheetPill} ${filter === 'both' ? styles.sheetPillActive : ''}`}
            onClick={() => setFilter('both')}
          >
            Both
          </button>
          <button
            type="button"
            className={`${styles.sheetPill} ${filter === 'dinein' ? styles.sheetPillActive : ''}`}
            onClick={() => setFilter('dinein')}
          >
            Dine-in buffets
          </button>
        </div>

        <div className={styles.sheetBody}>
          {filter === 'both' ? (
            <>
              {halls.map((hall) => {
                const avail = availableCount(hall);
                const total = hall.slots.length;
                const isOpen = expanded.has(hall.hall_id);

                return (
                  <div key={hall.hall_id} className={styles.hallCard}>
                    <button
                      type="button"
                      className={styles.hallHead}
                      onClick={() => toggle(hall.hall_id)}
                      aria-expanded={isOpen}
                    >
                      <span className={styles.hallIcon} data-tone={avail > 0 && avail === total ? 'blue' : 'terracotta'}>
                        <AppIcon name="building" size={22} />
                      </span>
                      <span className={styles.hallName}>{hall.hall_name}</span>
                      <span className={styles.hallAvail}>
                        {avail} of {total} available
                      </span>
                      <span className={isOpen ? styles.hallChevronOpen : ''}>
                        <AppIcon name="chevronDown" size={18} />
                      </span>
                    </button>

                    {isOpen ? (
                      <div className={styles.hallSlots}>
                        {hall.slots.map((slot) => {
                          const booking = slotBooking(slot);
                          const isAvail = slot.state === 'available';

                          return (
                            <div key={slot.slot_id} className={styles.slotRow}>
                              {isAvail ? (
                                <>
                                  <span className={styles.slotAvailIcon}>
                                    <AppIcon name="checkCircle" size={22} />
                                  </span>
                                  <span className={styles.slotName}>{slot.name.toUpperCase()}</span>
                                  {isPast ? null : (
                                    <Link
                                      href={`/banquet/new?date=${date}&hall_id=${hall.hall_id}&slot_id=${slot.slot_id}&hall_name=${encodeURIComponent(hall.hall_name)}&slot_name=${encodeURIComponent(slot.name)}&starts_at=${encodeURIComponent(slot.starts_at)}&ends_at=${encodeURIComponent(slot.ends_at)}`}
                                      className={styles.slotSelect}
                                    >
                                      Select
                                    </Link>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className={styles.slotBookedIcon}>
                                    <AppIcon name="noEntry" size={22} />
                                  </span>
                                  <div className={styles.slotInfo}>
                                    <span className={styles.slotName}>{slot.name}</span>
                                    {booking ? (
                                      <span className={styles.slotCustomer}>
                                        {booking.customer?.name ?? 'Guest'} &middot; {booking.guest_count + booking.extra_pax} PAX
                                      </span>
                                    ) : null}
                                  </div>
                                  <span className={styles.slotStatusTag}>
                                    {booking?.status === 'DRAFT' ? 'Draft' : 'Booked'}
                                  </span>
                                  {booking ? (
                                    <Link href={`/banquet/${booking.id}/edit`} className={styles.slotEdit}>
                                      <AppIcon name="ticket" size={16} />
                                      Edit
                                    </Link>
                                  ) : null}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <div className={styles.dineinSection}>
                <span className={styles.hallIcon} data-tone="green">
                  <AppIcon name="fork" size={22} />
                </span>
                <div>
                  <h3 className={styles.dineinTitle}>DINE-IN BUFFETS</h3>
                  <p className={styles.dineinDate}>{fullDate(date)}</p>
                </div>
              </div>
              <p className={styles.dineinEmpty}>No dine-in buffet bookings for this date</p>
            </>
          ) : (
            <>
              <div className={styles.dineinSection}>
                <span className={styles.hallIcon} data-tone="green">
                  <AppIcon name="fork" size={22} />
                </span>
                <div>
                  <h3 className={styles.dineinTitle}>DINE-IN BUFFETS</h3>
                  <p className={styles.dineinDate}>{fullDate(date)}</p>
                </div>
              </div>
              <p className={styles.dineinEmpty}>No dine-in buffet bookings for this date</p>
            </>
          )}
        </div>

        {isPast ? (
          <div className={styles.sheetFooter}>
            <p className={styles.pastNotice}>This date has passed. Bookings cannot be made for past dates.</p>
          </div>
        ) : (
          <div className={styles.sheetFooter}>
            <Link href={`/banquet/new?date=${date}&type=dinein`} className={styles.sheetAction}>
              <AppIcon name="plus" size={20} />
              Book a dine-in buffet
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BanquetAvailabilityPage() {
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
  const [kind, setKind] = useState<Kind>('both');
  const [view, setView] = useState<View>('calendar');
  const [month, setMonth] = useState(() => firstOfMonth(today));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [bookings, setBookings] = useState<BanquetBooking[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetDate, setSheetDate] = useState<string | null>(null);

  const from = view === 'calendar' ? month : weekStart;
  const to =
    view === 'calendar' ? addCalendarDays(month, daysInMonth(month) - 1) : addCalendarDays(weekStart, 6);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const [days, list] = await Promise.all([
        banquetApi.availability(ctx, { from, to }),
        banquetApi.listBookings(ctx, { date_field: 'event', from, to, limit: PAGE_SIZE }),
      ]);
      setAvailability(days);
      setBookings(list.data);
      setTruncated(list.meta.total > list.data.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load availability');
    } finally {
      setLoading(false);
    }
  }, [ctx, from, to]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const statesByDate = useMemo(() => {
    const map = new Map<string, DayState>();
    for (const day of availability?.days ?? []) map.set(day.date, dayState(day.halls, kind));
    return map;
  }, [availability, kind]);

  const sessionByBooking = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of availability?.days ?? []) {
      for (const hall of day.halls) {
        for (const slot of hall.slots) {
          for (const id of slot.booking_ids) map.set(id, slot.name);
        }
      }
    }
    return map;
  }, [availability]);

  const shown = useMemo(() => bookings.filter((b) => countsFor(b.status, kind)), [bookings, kind]);

  const sheetHalls = useMemo(() => {
    if (!sheetDate || !availability) return [];
    const day = availability.days.find((d) => d.date === sheetDate);
    return day?.halls ?? [];
  }, [sheetDate, availability]);

  const sheetBookings = useMemo(() => {
    if (!sheetDate) return [];
    return bookings.filter((b) => b.starts_at.slice(0, 10) === sheetDate);
  }, [sheetDate, bookings]);

  const header = <ScreenHeader crumb="Banquet › Booking" title="Banquet Availability" />;

  if (!ctx) return header;

  const weekDays = Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
  const leadingBlanks = weekdayIndex(month);
  const monthDays = Array.from({ length: daysInMonth(month) }, (_, i) => addCalendarDays(month, i));

  return (
    <>
      {header}
      <div className={chrome.content}>
        {error ? (
          <p role="alert" className={chrome.alert}>
            {error}
          </p>
        ) : null}

        <section className={chrome.card} aria-labelledby="choose-type">
          <div className={chrome.cardHead}>
            <span className={chrome.tile} data-tone="terracotta">
              <AppIcon name="filter" size={24} />
            </span>
            <h2 className={chrome.cardTitle} id="choose-type">
              Choose Type
            </h2>
          </div>
          <div className={styles.filters}>
            <label className="sr-only" htmlFor="booking-type">
              Booking type
            </label>
            <select
              id="booking-type"
              className={styles.typeSelect}
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>

            <div className={widgets.segmented} role="tablist" aria-label="Availability view">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'calendar'}
                className={`${widgets.segment} ${view === 'calendar' ? widgets.segmentActive : ''}`}
                onClick={() => setView('calendar')}
              >
                <AppIcon name="calendar" size={20} />
                Calendar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'weekly'}
                className={`${widgets.segment} ${view === 'weekly' ? widgets.segmentActive : ''}`}
                onClick={() => setView('weekly')}
              >
                <AppIcon name="columns" size={20} />
                Weekly
              </button>
            </div>
          </div>
        </section>

        {view === 'calendar' ? (
          <section className={chrome.card} aria-label="Availability calendar">
            <div className={styles.monthHead}>
              <h2 className={styles.monthName}>{monthName(month)}</h2>
              <div className={styles.stepper}>
                <button
                  type="button"
                  className={`${styles.step} ${styles.flip}`}
                  aria-label="Previous month"
                  onClick={() => setMonth(addMonths(month, -1))}
                >
                  <AppIcon name="chevronRight" size={20} />
                </button>
                <button
                  type="button"
                  className={styles.step}
                  aria-label="Next month"
                  onClick={() => setMonth(addMonths(month, 1))}
                >
                  <AppIcon name="chevronRight" size={20} />
                </button>
              </div>
            </div>

            <div className={styles.grid} role="presentation">
              {WEEKDAYS.map((d) => (
                <span key={d} className={styles.weekday}>
                  {d}
                </span>
              ))}
            </div>
            <ul className={styles.grid} aria-label={`${monthName(month)} availability`}>
              {Array.from({ length: leadingBlanks }, (_, i) => (
                <li key={`blank-${i}`} className={styles.blank} aria-hidden="true" />
              ))}
              {monthDays.map((date) => {
                const state = statesByDate.get(date) ?? 'none';
                const isToday = date === today;
                return (
                  <li key={date}>
                    <button
                      type="button"
                      className={`${styles.day} ${styles[state]} ${isToday ? styles.today : ''}`}
                      aria-label={`${shortDay(date)}: ${STATE_LABEL[state]}${isToday ? ', today' : ''}`}
                      onClick={() => setSheetDate(date)}
                    >
                      {dayNumber(date)}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={`${styles.dot} ${styles.dotAvailable}`} aria-hidden="true" />
                Available
              </span>
              <span className={styles.legendItem}>
                <span className={`${styles.dot} ${styles.dotPartial}`} aria-hidden="true" />
                Partial
              </span>
              <span className={styles.legendItem}>
                <span className={`${styles.dot} ${styles.dotFull}`} aria-hidden="true" />
                Fully Booked
              </span>
              <span className={styles.legendSpacer} />
              <span className={styles.legendItem}>
                <span className={`${styles.dot} ${styles.dotToday}`} aria-hidden="true" />
                Today
              </span>
            </div>
          </section>
        ) : (
          <section className={chrome.card} aria-label="Availability week">
            <div className={styles.weekBar}>
              <button
                type="button"
                className={`${styles.weekStep} ${styles.flip}`}
                aria-label="Previous week"
                onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}
              >
                <AppIcon name="chevronRight" size={20} />
              </button>
              <span className={styles.weekRange}>
                <AppIcon name="calendar" size={20} />
                {shortDay(weekStart)} - {shortDay(addCalendarDays(weekStart, 6))}
              </span>
              <button
                type="button"
                className={styles.weekStep}
                aria-label="Next week"
                onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}
              >
                <AppIcon name="chevronRight" size={20} />
              </button>
              <button type="button" className={styles.todayButton} onClick={() => setWeekStart(startOfWeek(today))}>
                Today
              </button>
            </div>

            <ul className={styles.week} aria-label="Bookings this week">
              {weekDays.map((date) => {
                const dayBookings = shown.filter((b) => b.starts_at.slice(0, 10) === date);
                const isToday = date === today;
                return (
                  <li
                    key={date}
                    className={`${styles.column} ${isToday ? styles.columnToday : ''}`}
                    aria-label={shortDay(date)}
                  >
                    <span className={styles.columnHead}>
                      {WEEKDAYS[weekdayIndex(date)]}
                      <span className={styles.columnDay}>{dayNumber(date)}</span>
                    </span>

                    {dayBookings.length === 0 ? (
                      <span className={styles.emptyColumn}>
                        <AppIcon name="emptyCalendar" size={28} />
                        No bookings
                      </span>
                    ) : (
                      dayBookings.map((b) => (
                        <article key={b.id} className={styles.bookingCard} aria-label={`Booking for ${b.customer?.name ?? 'a guest'}`}>
                          <span className={styles.bookingName}>{b.customer?.name ?? 'Guest'}</span>
                          <span className={styles.bookingMeta}>
                            <AppIcon name="people" size={16} />
                            {b.guest_count + b.extra_pax} pax
                          </span>
                          <span className={styles.bookingMeta}>
                            <AppIcon name="pin" size={16} />
                            {b.hall_name}
                          </span>
                          <span className={styles.bookingMeta}>
                            <AppIcon name="clock" size={16} />
                            {sessionByBooking.get(b.id) ?? formatTime(b.starts_at, tz)}
                          </span>
                          {b.status === 'DRAFT' ? <span className={styles.draftTag}>Draft</span> : null}
                          <Link className={styles.editLink} href={`/banquet/${b.id}/edit`}>
                            Edit
                            <AppIcon name="chevronRight" size={16} />
                          </Link>
                        </article>
                      ))
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {truncated ? (
          <p className={widgets.warn}>
            More than {PAGE_SIZE} bookings fall in this window; only the first {PAGE_SIZE} are shown. Narrow the
            period to see the rest.
          </p>
        ) : null}

        {loading ? (
          <p className={widgets.hint} role="status" aria-live="polite">
            Loading availability&hellip;
          </p>
        ) : (
          <p className={widgets.hint}>Days are this branch&rsquo;s own days ({tz}).</p>
        )}
      </div>

      {sheetDate ? (
        <DaySheet
          date={sheetDate}
          halls={sheetHalls}
          bookings={sheetBookings}
          tz={tz}
          onClose={() => setSheetDate(null)}
        />
      ) : null}
    </>
  );
}
