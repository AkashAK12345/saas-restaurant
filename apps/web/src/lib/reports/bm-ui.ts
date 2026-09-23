import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';

/**
 * Presentation-only hints for the BM Checklist screen: the manager's log
 * (`tasks.bm`) and, beneath it, who filed it (`tasks.bm_compliance`, styled
 * as on the EOD screen — see eod-ui.ts).
 */
export const BM_LOG_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_reports: { icon: 'clipboardCheck', tone: 'blue' },
  avg_daily: { icon: 'checkRing', tone: 'green' },
  avg_briefing: { icon: 'speaking', tone: 'amber' },
};

/** The three cards; branches and days stay in the response for export. */
export const BM_LOG_CARDS = ['total_reports', 'avg_daily', 'avg_briefing'] as const;

export const BM_SEARCHABLE_COLUMNS = ['date', 'submitted_by', 'branch_name', 'manager', 'remarks'] as const;

/** A "5/6" score: green when (nearly) all were covered, amber, then red. */
export function scoreTone(value: unknown): BadgeSpec['tone'] | undefined {
  const m = /^(\d+(?:\.\d+)?)\/(\d+)$/.exec(String(value));
  if (!m || Number(m[2]) === 0) return undefined;
  const ratio = Number(m[1]) / Number(m[2]);
  return ratio >= 0.8 ? 'success' : ratio >= 0.5 ? 'warning' : 'danger';
}

/** Yes in green, No in red; any other text is left plain. */
export function yesNoTone(value: unknown): BadgeSpec['tone'] | undefined {
  if (value === 'Yes') return 'success';
  if (value === 'No') return 'danger';
  return undefined;
}

export const BM_YES_NO_COLUMNS = [
  'staff_groomed',
  'tv_music',
  'staff_on_time',
  'dining_clean',
  'equipment',
  'restroom',
] as const;
