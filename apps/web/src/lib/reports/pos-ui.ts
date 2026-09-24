import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';
import { shiftDate } from '@/lib/reports/format';

/**
 * Presentation-only helpers for the POS Reports screen (`/reports/pos`): its
 * three tabs read the `pos.*` reports — Summary and Orders for one day,
 * Analytics over a chosen range.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thursday, 24 September 2026" — a calendar date, read without any zone. */
export function longDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "24 Sep 2026", or "18 Sep – 24 Sep 2026" for a range. */
export function rangeLabel(from: string, to: string): string {
  const short = (date: string, withYear: boolean) => {
    const [y, m, d] = date.split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ''}`;
  };
  if (from === to) return short(from, true);
  return `${short(from, from.slice(0, 4) !== to.slice(0, 4))} – ${short(to, true)}`;
}

export type AnalyticsPreset = 'today' | '7d' | '30d' | 'custom';

/** The window a preset chip stands for, ending today. */
export function presetRange(preset: Exclude<AnalyticsPreset, 'custom'>, today: string) {
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : 30;
  return { from: shiftDate(today, -(days - 1)), to: today };
}

export const POS_SUMMARY_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_orders: { icon: 'receipt', tone: 'blue' },
  dine_in: { icon: 'fork', tone: 'green' },
  takeaway: { icon: 'box', tone: 'amber' },
  avg_order: { icon: 'trendUp', tone: 'purple' },
  cancelled: { icon: 'noEntry', tone: 'red' },
  success_rate: { icon: 'checkCircle', tone: 'terracotta' },
};

/** The Summary grid, in the reference's order; revenue has its own card. */
export const POS_SUMMARY_CARDS = ['total_orders', 'dine_in', 'takeaway', 'avg_order', 'cancelled', 'success_rate'] as const;

export const POS_ANALYTICS_ICONS: Readonly<Record<string, MetricIcon>> = {
  revenue: { icon: 'trendUp', tone: 'green' },
  paid_orders: { icon: 'receipt', tone: 'blue' },
  avg_order: { icon: 'trendUp', tone: 'purple' },
  all_orders: { icon: 'checklist', tone: 'terracotta' },
  cancelled: { icon: 'noEntry', tone: 'red' },
  peak_hour: { icon: 'clock', tone: 'amber' },
};

export const ORDER_STATUS_BADGES: Readonly<Record<string, BadgeSpec>> = {
  PAID: { label: 'Paid', tone: 'success' },
  OPEN: { label: 'Open', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

export const ORDER_TYPE_LABELS: Readonly<Record<string, string>> = {
  DINE_IN: 'Dine In',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

/** Slice colours for the order-type chart, from the app's accent tokens. */
export const ORDER_TYPE_COLOURS: readonly string[] = [
  'var(--accent-terracotta-fg)',
  'var(--accent-blue-fg)',
  'var(--accent-green-fg)',
  'var(--accent-amber-fg)',
];

/**
 * Every hour from the first to the last that took money, gaps as zero, so
 * the bars read as a day rather than a scatter of busy hours.
 */
export function hourlySeries(
  rows: ReadonlyArray<{ hour: number; hour_label: string; revenue_minor: number }>,
): Array<{ hour: number; label: string; revenue: number }> {
  if (rows.length === 0) return [];
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const first = Math.min(...rows.map((r) => r.hour));
  const last = Math.max(...rows.map((r) => r.hour));
  const series: Array<{ hour: number; label: string; revenue: number }> = [];
  for (let h = first; h <= last; h += 1) {
    const row = byHour.get(h);
    const label = row?.hour_label ?? `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
    series.push({ hour: h, label, revenue: row?.revenue_minor ?? 0 });
  }
  return series;
}
