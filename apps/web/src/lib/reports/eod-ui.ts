import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';
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

export const EOD_COMPLIANCE_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  compliance: { icon: 'badgeCheck', tone: 'green' },
  submitted: { icon: 'checkRing', tone: 'green' },
  missed: { icon: 'calendarX', tone: 'red' },
  pending: { icon: 'hourglass', tone: 'amber' },
};

/** The four cards; staff_count/due_days feed the panel's badge instead. */
export const EOD_COMPLIANCE_CARDS = ['compliance', 'submitted', 'missed', 'pending'] as const;

/** Green when (nearly) every day was filed, amber when some slipped, red below that. */
export function complianceTone(rate: number): BadgeSpec['tone'] {
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
