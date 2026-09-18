'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { banquetApi } from '@/lib/banquet/api';
import { branchToday, deviceTimeZone } from '@/lib/format/datetime';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import type { BanquetFinance } from '@/lib/banquet/types';
import chrome from '@/components/app/screen-chrome.module.css';
import styles from '@/components/banquet/finance.module.css';

/** Longest range the API answers in one request. */
const MAX_RANGE_DAYS = 366;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const parts = (date: string) => ({
  y: Number(date.slice(0, 4)),
  m: Number(date.slice(5, 7)) - 1,
  d: Number(date.slice(8, 10)),
});
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthEnd = (date: string) => {
  const { y, m } = parts(date);
  return iso(y, m, daysInMonth(y, m));
};
const shiftMonth = (date: string, n: number) => {
  const { y, m } = parts(date);
  const d = new Date(Date.UTC(y, m + n, 1));
  return iso(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** "01 Sep 2026" */
const longLabel = (date: string) => {
  const { y, m, d } = parts(date);
  return `${String(d).padStart(2, '0')} ${MONTHS_SHORT[m]} ${y}`;
};

/** Whole rupees, the way the overview reads them: ₹1493090, ₹-85500. */
const rupees = (minor: number) => `₹${Math.round(minor / 100)}`;

export default function BanquetFinancePage() {
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
  const [range, setRange] = useState(() => ({ from: monthStart(today), to: monthEnd(today) }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [data, setData] = useState<BanquetFinance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const result = await banquetApi.finance(ctx, {
        from: range.from,
        to: range.to,
        ...(pendingOnly ? { payment: 'pending' } : {}),
      });
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load finance data');
    } finally {
      setLoading(false);
    }
  }, [ctx, range, pendingOnly]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect.
    void (async () => {
      await load();
    })();
  }, [load]);

  // "18 Sep, 2026" — the event's own day at the branch, not the device's.
  // Numeric parts and our own month names: some locales write "Sept".
  const eventDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'numeric', year: 'numeric', timeZone: tz });
    return (instant: string) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
      return `${p.day} ${MONTHS_SHORT[Number(p.month) - 1]}, ${p.year}`;
    };
  }, [tz]);

  const header = <ScreenHeader crumb="Banquet" title="Finance Overview" plain />;
  if (!ctx) return header;

  return (
    <>
      {header}
      <div className={chrome.content}>
        {error ? <p role="alert" className={chrome.alert}>{error}</p> : null}

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.tile} data-tone="terracotta"><AppIcon name="sliders" size={24} /></span>
            <h2 className={styles.cardTitle}>Filters</h2>
          </div>
          <button
            type="button"
            className={styles.rangeButton}
            aria-label={`Date range ${longLabel(range.from)} to ${longLabel(range.to)}. Change`}
            onClick={() => setPickerOpen(true)}
          >
            <span className={styles.tile} data-tone="blue"><AppIcon name="calendar" size={22} /></span>
            <span className={styles.rangeText}>{longLabel(range.from)} - {longLabel(range.to)}</span>
            <span className={styles.caret} aria-hidden="true" />
          </button>
        </section>

        {/* ── Totals ─────────────────────────────────────────────────────── */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.tile} data-tone="blue"><AppIcon name="trendUp" size={24} /></span>
            <span className={styles.statLabel}>Total Revenue</span>
            <span className={styles.statValue} data-tone="blue">{data ? rupees(data.total_revenue_minor) : '—'}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.tile} data-tone="green"><AppIcon name="cash" size={24} /></span>
            <span className={styles.statLabel}>Total Received</span>
            <span className={styles.statValue} data-tone="green">{data ? rupees(data.total_paid_minor) : '—'}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.tile} data-tone="amber"><AppIcon name="clipboardClock" size={24} /></span>
            <span className={styles.statLabel}>Pending</span>
            <span className={styles.statValue} data-tone="amber">{data ? rupees(data.total_outstanding_minor) : '—'}</span>
          </div>
        </div>

        {/* ── Pending only ───────────────────────────────────────────────── */}
        <section className={`${styles.card} ${styles.toggleRow}`}>
          <span className={styles.tile} data-tone="amber"><AppIcon name="funnel" size={22} /></span>
          <span id="fin-pending-label" className={styles.toggleLabel}>Show Pending Payments Only</span>
          <button
            type="button"
            role="switch"
            aria-checked={pendingOnly}
            aria-labelledby="fin-pending-label"
            className={styles.switch}
            onClick={() => setPendingOnly((v) => !v)}
          />
        </section>

        {/* ── Bookings list ──────────────────────────────────────────────── */}
        <section className={`${styles.card} ${styles.listCard}`}>
          <div className={`${styles.cardHead} ${styles.listHead}`}>
            <span className={styles.tile} data-tone="red"><AppIcon name="columns" size={26} /></span>
            <h2 className={styles.cardTitle}>Bookings List</h2>
            <span className={styles.count} aria-label={`${data?.bookings.length ?? 0} bookings`}>
              {data?.bookings.length ?? 0}
            </span>
          </div>
          {loading && !data ? (
            <p className={styles.loading}>Loading…</p>
          ) : data && data.bookings.length === 0 ? (
            <p className={styles.empty}>
              {pendingOnly ? 'No pending payments in this range.' : 'No bookings in this range.'}
            </p>
          ) : data ? (
            <ul className={styles.rows}>
              {data.bookings.map((b) => {
                const due = b.remaining_minor > 0;
                return (
                  <li key={b.id}>
                    <Link href={`/banquet/${b.id}`} className={styles.row} data-pending={due}>
                      <span className={styles.tile} data-tone={due ? 'amber' : 'green'}>
                        <AppIcon name={due ? 'moreCircle' : 'checkCircle'} size={26} />
                      </span>
                      <span className={styles.rowMain}>
                        <span className={styles.rowName}>{b.customer_name}</span>
                        <span className={styles.rowMeta}>
                          {b.guest_count + b.extra_pax} PAX &nbsp;•&nbsp; {eventDate(b.starts_at)}
                        </span>
                      </span>
                      <span className={styles.rowMoney}>
                        <span className={styles.rowAmount} data-due={due}>{rupees(b.remaining_minor)}</span>
                        <span className={styles.rowRemaining}>remaining</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>

      {pickerOpen ? (
        <RangePicker
          from={range.from}
          to={range.to}
          today={today}
          onClose={() => setPickerOpen(false)}
          onSave={(next) => {
            setRange(next);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Full-screen date-range picker: tap a start day, then an end day, then Save.
 * The pencil switches to typing the two dates instead.
 */
function RangePicker({
  from,
  to,
  today,
  onClose,
  onSave,
}: {
  from: string;
  to: string;
  today: string;
  onClose: () => void;
  onSave: (range: { from: string; to: string }) => void;
}) {
  const [start, setStart] = useState<string | null>(from);
  const [end, setEnd] = useState<string | null>(to);
  const [typing, setTyping] = useState(false);
  const firstMonthRef = useRef<HTMLElement | null>(null);

  // Six months back and a year ahead of the current selection; the pencil
  // reaches any other date.
  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = -6; i <= 12; i++) out.push(shiftMonth(from, i));
    return out;
  }, [from]);

  useEffect(() => {
    firstMonthRef.current?.scrollIntoView({ block: 'start' });
  }, [typing]);

  const pick = (date: string) => {
    if (!start || end) {
      setStart(date);
      setEnd(null);
    } else if (date < start) {
      setStart(date);
    } else {
      setEnd(date);
    }
  };

  const finalEnd = end ?? start;
  const tooLong = !!start && !!finalEnd && spanDays(start, finalEnd) > MAX_RANGE_DAYS;
  const canSave = !!start && !!finalEnd && finalEnd >= start && !tooLong;

  const heading = (() => {
    if (!start) return 'Start date – End date';
    const s = parts(start);
    const label = (p: { y: number; m: number; d: number }, withYear: boolean) =>
      `${MONTHS_SHORT[p.m]} ${p.d}${withYear ? `, ${p.y}` : ''}`;
    if (!end) return `${label(s, false)} – End date`;
    const e = parts(end);
    const crossYear = s.y !== e.y;
    return `${label(s, crossYear)} – ${label(e, crossYear)}`;
  })();

  return (
    <div className={styles.picker} role="dialog" aria-modal="true" aria-label="Select range">
      <div className={styles.pickerBar}>
        <button type="button" className={styles.pickerIconButton} aria-label="Close" onClick={onClose}>
          <AppIcon name="close" size={28} />
        </button>
        <button
          type="button"
          className={styles.pickerSave}
          disabled={!canSave}
          onClick={() => canSave && onSave({ from: start!, to: finalEnd! })}
        >
          Save
        </button>
      </div>

      <div className={styles.pickerHeading}>
        <div>
          <p className={styles.pickerKicker}>Select range</p>
          <p className={styles.pickerRange} aria-live="polite">{heading}</p>
        </div>
        <button
          type="button"
          className={styles.pickerIconButton}
          aria-label={typing ? 'Switch to calendar' : 'Switch to typing the dates'}
          onClick={() => setTyping((t) => !t)}
        >
          <AppIcon name={typing ? 'calendar' : 'pencil'} size={26} />
        </button>
      </div>
      {tooLong ? <p className={styles.pickerHint}>Choose at most {MAX_RANGE_DAYS} days.</p> : null}

      {typing ? (
        <div className={styles.textEntry}>
          <label>
            Start date
            <input type="date" value={start ?? ''} onChange={(e) => setStart(e.target.value || null)} />
          </label>
          <label>
            End date
            <input type="date" value={end ?? ''} min={start ?? undefined} onChange={(e) => setEnd(e.target.value || null)} />
          </label>
        </div>
      ) : (
        <>
          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className={styles.months}>
            {months.map((first) => {
              const { y, m } = parts(first);
              const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
              const count = daysInMonth(y, m);
              return (
                <section key={first} ref={first === monthStart(from) ? firstMonthRef : undefined} aria-label={`${MONTHS_LONG[m]} ${y}`}>
                  <h3 className={styles.monthTitle}>{MONTHS_LONG[m]} {y}</h3>
                  <div className={styles.days}>
                    {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} className={styles.day} />)}
                    {Array.from({ length: count }, (_, i) => {
                      const date = iso(y, m, i + 1);
                      const isStart = date === start;
                      const isEnd = date === end;
                      const inside = !!start && !!end && date > start && date < end;
                      const band =
                        start && end && start !== end
                          ? isStart ? 'start' : isEnd ? 'end' : inside ? 'mid' : undefined
                          : undefined;
                      return (
                        <span key={date} className={styles.day} data-band={band}>
                          <button
                            type="button"
                            className={styles.dayButton}
                            aria-pressed={isStart || isEnd}
                            aria-label={`${i + 1} ${MONTHS_LONG[m]} ${y}`}
                            data-today={date === today}
                            onClick={() => pick(date)}
                          >
                            {i + 1}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

