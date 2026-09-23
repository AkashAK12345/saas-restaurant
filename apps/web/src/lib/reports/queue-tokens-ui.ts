import { STATUS_LABEL, type QueueTokenStatus } from '@/lib/queue/types';
import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';

/**
 * Presentation-only hints for the `queue.tokens` report page: which icon each
 * metric gets, and which colour each status badge gets.
 *
 * Deliberately kept OUT of `report-table.tsx` / `metric-grid.tsx` — those stay
 * generic, rendering whatever any report declares. This file is the one place
 * that knows queue.tokens by name, the same way `checklist-reports.ts` is the
 * one place that knows the Quick Access tiles by name.
 */
export const QUEUE_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_customers: { icon: 'people', tone: 'blue' },
  avg_wait_seconds: { icon: 'clock', tone: 'amber' },
  total_pax: { icon: 'personAdd', tone: 'green' },
  avg_pax: { icon: 'trendUp', tone: 'terracotta' },
};

const STATUS_TONE: Record<QueueTokenStatus, BadgeSpec['tone']> = {
  SCHEDULED: 'neutral',
  WAITING: 'warning',
  CALLED: 'primary',
  SEATED: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'danger',
};

export const QUEUE_STATUS_BADGES: Readonly<Record<string, BadgeSpec>> = Object.fromEntries(
  (Object.keys(STATUS_LABEL) as QueueTokenStatus[]).map((status) => [
    status,
    { label: STATUS_LABEL[status], tone: STATUS_TONE[status] },
  ]),
);

/** Columns the "Queue Log" search box matches against, in order of relevance. */
export const QUEUE_SEARCHABLE_COLUMNS = ['customer_name', 'operator_email', 'table_label'] as const;
