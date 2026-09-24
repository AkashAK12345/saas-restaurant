import type { MetricIcon } from '@/components/reports/metric-grid';

/**
 * Presentation-only hints for the Kitchen Balance screen: the balance log
 * (`tasks.kitchen_balance`, one row per submission, totalled by section) and,
 * beneath it, who filed it (`tasks.kitchen_balance_compliance`, styled as on
 * the EOD screen — see eod-ui.ts).
 */
export const KITCHEN_BALANCE_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_reports: { icon: 'archive', tone: 'blue' },
  total_items: { icon: 'fork', tone: 'amber' },
  avg_items: { icon: 'barChart', tone: 'green' },
};

export const KITCHEN_BALANCE_SEARCHABLE_COLUMNS = ['date', 'submitted_by', 'branch_name'] as const;
