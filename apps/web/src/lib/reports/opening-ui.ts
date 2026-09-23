import type { MetricIcon } from '@/components/reports/metric-grid';
import type { SectionLook } from '@/components/reports/checklist-details-dialog';

/**
 * Presentation-only hints for the Branch Head Opening screen: the checklist
 * log (`tasks.opening`, one row per submission, each opening in full) and,
 * beneath it, who filed it (`tasks.opening_compliance`, styled as on the EOD
 * screen — see eod-ui.ts).
 */
export const OPENING_LOG_METRIC_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_reports: { icon: 'clipboardCheck', tone: 'blue' },
  branches: { icon: 'building', tone: 'amber' },
  date_range: { icon: 'calendar', tone: 'green' },
};

export const OPENING_SEARCHABLE_COLUMNS = ['date', 'submitted_by', 'branch_name', 'remarks'] as const;

/**
 * The details view colours three sections differently from the task form
 * (where they sit beside other checklists' sections and need telling apart).
 */
export const OPENING_SECTION_LOOKS: Readonly<Record<string, SectionLook>> = {
  'Reception & Front Area': { icon: 'store', tone: 'red' },
  'Kitchen & Supplies': { icon: 'fridge', tone: 'amber' },
  Remarks: { icon: 'notes', tone: 'neutral' },
};
