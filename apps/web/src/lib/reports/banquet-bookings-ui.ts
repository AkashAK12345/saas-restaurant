import { BOOKING_STATUS_LABEL, type BanquetBookingStatus } from '@/lib/banquet/types';
import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';

/**
 * Presentation-only hints for the `banquet.bookings` report page — which icon
 * each headline metric gets, and which colour each status badge gets.
 *
 * Kept out of the generic table/metric components, the same way
 * `queue-tokens-ui.ts` is; this is the one place that knows banquet.bookings
 * by name. Reuses the SAME status label/tone the booking list already shows
 * (`BOOKING_STATUS_LABEL`, `banquet.module.css`'s badge colours) rather than
 * inventing a second name for the same four states.
 */
export const BANQUET_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_bookings: { icon: 'calendar', tone: 'blue' },
  confirmed: { icon: 'checkCircle', tone: 'green' },
  drafts: { icon: 'pencil', tone: 'amber' },
};

const STATUS_TONE: Record<BanquetBookingStatus, BadgeSpec['tone']> = {
  DRAFT: 'warning',
  CONFIRMED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

export const BANQUET_STATUS_BADGES: Readonly<Record<string, BadgeSpec>> = Object.fromEntries(
  (Object.keys(BOOKING_STATUS_LABEL) as BanquetBookingStatus[]).map((status) => [
    status,
    { label: BOOKING_STATUS_LABEL[status], tone: STATUS_TONE[status] },
  ]),
);

/** Columns the "Bookings" search box matches against, in order of relevance. */
export const BANQUET_SEARCHABLE_COLUMNS = ['customer_name', 'hall_name', 'notes'] as const;

/** The report emits a Revenue metric per currency present; only the first is
 *  shown as a headline card — a second currency still exists in the raw API
 *  response (and the export), it just doesn't crowd this one screen. */
export function banquetRevenueIcon(key: string): MetricIcon | undefined {
  return key.startsWith('revenue_') ? { icon: 'cash', tone: 'terracotta' } : undefined;
}
