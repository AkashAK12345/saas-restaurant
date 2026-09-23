import { PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskPriority, type TaskStatus } from '@/lib/tasks/types';
import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';

/**
 * Presentation-only hints for the `tasks.log` report page — the Task Log.
 *
 * Kept out of the generic table/metric components, the same way
 * `queue-tokens-ui.ts` and `banquet-bookings-ui.ts` are. Status and priority
 * reuse the labels and colours the task board already shows
 * (`TASK_STATUS_LABEL`, `PRIORITY_LABEL`, `tasks.module.css`'s badges).
 */
export const TASK_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_tasks: { icon: 'clipboard', tone: 'blue' },
  completed: { icon: 'checkCircle', tone: 'green' },
  pending: { icon: 'moreCircle', tone: 'amber' },
  overdue: { icon: 'warning', tone: 'red' },
};

const STATUS_TONE: Record<TaskStatus, BadgeSpec['tone']> = {
  PENDING: 'warning',
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const PRIORITY_TONE: Record<TaskPriority, BadgeSpec['tone']> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'danger',
};

export const TASK_STATUS_BADGES: Readonly<Record<string, BadgeSpec>> = Object.fromEntries(
  (Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => [
    s,
    { label: TASK_STATUS_LABEL[s], tone: STATUS_TONE[s] },
  ]),
);

export const TASK_PRIORITY_BADGES: Readonly<Record<string, BadgeSpec>> = Object.fromEntries(
  (Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => [
    p,
    { label: PRIORITY_LABEL[p], tone: PRIORITY_TONE[p] },
  ]),
);

export const TASK_SEARCHABLE_COLUMNS = ['title', 'assignee_name'] as const;

/**
 * The chip row, in the reference design's order. Values are the report's own
 * `view` option — the server does the filtering, so pagination and export
 * follow the chip. The reference's "Pending Approval" chip is absent on
 * purpose: SAMCO tasks have no approval step for it to show.
 */
export const TASK_VIEW_CHIPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'INCOMPLETE', label: 'Incomplete' },
  { value: 'OVERDUE', label: 'Overdue' },
];
