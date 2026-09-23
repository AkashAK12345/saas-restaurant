import type { MetricIcon } from '@/components/reports/metric-grid';
import type { ReportMetric } from '@/lib/reports/types';

/**
 * Presentation-only hints for the EOD Reports screen: the transposed EOD log
 * (`tasks.eod`) and, beneath it, who filed it (`tasks.eod_compliance`).
 */
export const EOD_LOG_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_reports: { icon: 'document', tone: 'blue' },
  with_complaints: { icon: 'warning', tone: 'amber' },
  food_complaints: { icon: 'fork', tone: 'red' },
  service_issues: { icon: 'headset', tone: 'red' },
};

/**
 * The compliance cards' icons, shared by every checklist screen. The rate's
 * badge takes the rate's own colour — green, amber or red — and stays blue
 * while nothing was due to rate.
 */
export function complianceMetricIcons(metrics: readonly ReportMetric[]): Record<string, MetricIcon> {
  const rate = metrics.find((m) => m.key === 'compliance')?.value;
  const tone =
    typeof rate === 'number'
      ? ({ success: 'green', warning: 'amber', danger: 'red' } as const)[complianceTone(rate)]
      : 'blue';
  return {
    compliance: { icon: 'badgeCheck', tone },
    submitted: { icon: 'checkRing', tone: 'green' },
    missed: { icon: 'calendarX', tone: 'red' },
    pending: { icon: 'hourglass', tone: 'amber' },
  };
}

/** The four cards; filed_today (named in Pending's label), staff_count and
 *  due_days (the panel's badge) are not cards of their own. */
export const EOD_COMPLIANCE_CARDS = ['compliance', 'submitted', 'missed', 'pending'] as const;

/** Green when (nearly) every day was filed, amber when some slipped, red below that. */
export function complianceTone(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 90) return 'success';
  if (rate >= 60) return 'warning';
  return 'danger';
}

/** "1 staff · 7 days" — the people responsible, and the days that were due. */
export function complianceCountLabel(metrics: readonly ReportMetric[]): string {
  const value = (key: string) => Number(metrics.find((m) => m.key === key)?.value ?? 0);
  const days = value('due_days');
  return `${value('staff_count')} staff · ${days} ${days === 1 ? 'day' : 'days'}`;
}
