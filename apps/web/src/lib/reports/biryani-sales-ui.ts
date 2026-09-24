import type { MetricIcon } from '@/components/reports/metric-grid';

/**
 * Presentation-only hints for the Biryani Sales screen: the sales log
 * (`tasks.biryani_sales`, one row per submission, each figure totalled over
 * the product lines) and, beneath it, who filed it
 * (`tasks.biryani_sales_compliance`, styled as on the EOD screen — see
 * eod-ui.ts).
 */
export const BIRYANI_SALES_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_reports: { icon: 'fork', tone: 'blue' },
  purchase: { icon: 'cart', tone: 'amber' },
  morning_sales: { icon: 'sun', tone: 'green' },
  evening_sales: { icon: 'moon', tone: 'red' },
};

/** The four cards; the period's order quantity stays in the export. */
export const BIRYANI_SALES_CARDS = ['total_reports', 'purchase', 'morning_sales', 'evening_sales'] as const;

export const BIRYANI_SALES_SEARCHABLE_COLUMNS = ['date', 'submitted_by', 'branch_name', 'remarks'] as const;
