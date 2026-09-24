import type { MetricIcon } from '@/components/reports/metric-grid';

/**
 * Presentation-only hints for the Stock Requests screen: the request log
 * (`tasks.stock_requests`, a row per department asked for, filterable by
 * department) and, beneath it, who filed it (`tasks.stock_requests_compliance`,
 * styled as on the EOD screen — see eod-ui.ts).
 */
export const STOCK_REQUEST_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_requests: { icon: 'cart', tone: 'blue' },
  total_items: { icon: 'box', tone: 'amber' },
  avg_items: { icon: 'barChart', tone: 'green' },
  departments: { icon: 'fork', tone: 'purple' },
};

export const STOCK_REQUEST_SEARCHABLE_COLUMNS = ['date', 'submitted_by', 'branch_name', 'department', 'items'] as const;
