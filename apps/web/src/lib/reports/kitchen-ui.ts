import type { MetricIcon } from '@/components/reports/metric-grid';

/**
 * Presentation-only hints for the Kitchen Checklist screen: the kitchen log
 * (`tasks.kitchen`, one row per submission) and, beneath it, who filed it
 * (`tasks.kitchen_compliance`, styled as on the EOD screen — see eod-ui.ts).
 */
export const KITCHEN_LOG_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_checklists: { icon: 'fork', tone: 'blue' },
  with_images: { icon: 'image', tone: 'green' },
  hygiene_issues: { icon: 'warning', tone: 'amber' },
  fifo_followed: { icon: 'checkCircle', tone: 'red' },
};
