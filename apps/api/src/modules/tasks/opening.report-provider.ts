import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toLocalDateString } from '../reports/report-values.js';
import {
  COMPLIANCE_COLUMNS,
  dayLabel,
  displayAnswer,
  instantLabel,
  loadSubmissions,
  referenceForm,
  runCompliance,
} from './checklist-report.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * Branch Head Opening reporting — the pre-opening round, read back. See
 * checklist-report.ts for what counts as a submission and whose day it is.
 *
 * One row per submission, newest first, with the answers a manager scans
 * down; the whole form, photos included, opens from the row on screen (it is
 * the task's own checklist, so it is read from the task, not duplicated here).
 */

/** Log column -> the form question it shows. */
const ANSWERS = {
  security: { label: 'Security', field: 'Security present as per roster?' },
  valet: { label: 'Valet', field: 'Valet drivers present as per roster?' },
  grooming: { label: 'Grooming', field: 'Security & valet staff grooming standard?' },
  cashiers: { label: 'Cashiers', field: 'Cashiers present on time?' },
  meat_veg: {
    label: 'Meat/Veg',
    field: 'Have you received meat, vegetables, dairy products and other supplies?',
  },
  kitchen: { label: 'Kitchen', field: 'Central kitchen items arrived (Briyani, Masala, Gravies)?' },
  ready: { label: 'Ready', field: 'Restaurant ready for service?' },
  manager: { label: 'Manager', field: 'Manager present on time?' },
  cctv: { label: 'CCTV', field: 'CCTV cameras working?' },
  remarks: { label: 'Remarks', field: 'Any additional remarks or observations' },
} as const;

const OPENING = referenceForm(
  'opening-checklist',
  Object.values(ANSWERS).map((a) => a.field),
);

/** Calendar days in the window, both ends included — the "8d" card. */
export function windowDays(fromLocal: string, toLocal: string): number {
  const ms = Date.parse(`${toLocal}T00:00:00Z`) - Date.parse(`${fromLocal}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000) + 1);
}

@Injectable()
export class OpeningLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.opening',
    name: 'Branch Head Opening',
    description: 'Every Branch Head Opening Checklist submitted in the period, newest first.',
    domain: 'tasks',
    scope: 'branch',
    // A branch files one a day, so a period's log is short enough to send whole.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      ...Object.entries(ANSWERS).map(([key, a]) => ({ key, label: a.label, type: 'string' as const })),
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, OPENING.name);
    // Newest first, as the screen lists them.
    const rows = [...forms.submissions].reverse().map((s) => ({
      task_id: s.task_id,
      date: dayLabel(toLocalDateString(s.report_date), true),
      submitted_at: instantLabel(s.completed_at, query.ctx.timezone),
      submitted_by: s.submitted_by,
      ...Object.fromEntries(
        Object.entries(ANSWERS).map(([key, a]) => [key, displayAnswer(forms.answers.get(s.task_id)?.get(a.field))]),
      ),
    }));

    return {
      rows,
      total: rows.length,
      metrics: [
        { key: 'total_reports', label: 'Total Reports', value: rows.length, type: 'number' },
        // One branch per run today; the card is ready for an all-branches view.
        { key: 'branches', label: 'Branches', value: rows.length > 0 ? 1 : 0, type: 'number' },
        {
          key: 'date_range',
          label: 'Date Range',
          value: `${windowDays(query.range.fromLocal, query.range.toLocal)}d`,
          type: 'string',
        },
      ],
    };
  }
}

/** Whether the Branch Head Opening Checklist was filed each day, per person responsible. */
@Injectable()
export class OpeningComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.opening_compliance',
    name: 'Branch Head Opening Submission Compliance',
    description: 'Whether the Branch Head Opening Checklist was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, OPENING.name);
  }
}
