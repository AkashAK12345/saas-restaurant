import type { MetricIcon } from '@/components/reports/metric-grid';

/**
 * Presentation-only hints for the Operational Checklist screen: the transposed
 * checklist log (`tasks.operational`) and, beneath it, who filed it
 * (`tasks.operational_compliance`). The compliance pill and "N staff · N days"
 * line are the EOD screen's — see eod-ui.ts.
 */
export const OPERATIONAL_LOG_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_checklists: { icon: 'checklist', tone: 'blue' },
  avg_security: { icon: 'shield', tone: 'amber' },
  avg_readiness: { icon: 'checkCircle', tone: 'green' },
  avg_operation: { icon: 'star', tone: 'red' },
};

export const OPERATIONAL_COMPLIANCE_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  compliance: { icon: 'badgeCheck', tone: 'blue' },
  submitted: { icon: 'checkRing', tone: 'green' },
  missed: { icon: 'calendarX', tone: 'red' },
  pending: { icon: 'hourglass', tone: 'amber' },
};
