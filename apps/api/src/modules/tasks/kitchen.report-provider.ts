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
  photoCounts,
  referenceForm,
  runCompliance,
} from './checklist-report.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * Kitchen Checklist reporting — the daily kitchen round, read back. See
 * checklist-report.ts for what counts as a submission and whose day it is.
 *
 * Unlike the EOD and Operational screens, the log is NOT transposed: one row
 * per submission, with the five answers a head chef scans for and how many
 * photos came with it. The full form stays on the task, one tap away.
 */

/** Log column -> the form question it shows. */
const ANSWERS = {
  meat_veg_dairy: {
    label: 'Meat/Veg/Dairy',
    field: 'Have you received the meat, vegetables, dairy products and other supplies on time?',
  },
  equipment: {
    label: 'Equipment',
    field: 'Does all the kitchen equipment (Burners, refrigerators, exhaust) work properly?',
  },
  depts_ready: {
    label: 'Depts Ready',
    field: 'Are all the departments ready for service (Chinese, Tandoor, Indian, etc.)?',
  },
  hygiene: { label: 'Hygiene', field: 'Has the kitchen been cleaned & hygiene maintained after service?' },
  fifo: { label: 'FIFO', field: 'Is the FIFO process being followed for short-expiry items?' },
} as const;

const KITCHEN = referenceForm(
  'kitchen-checklist',
  Object.values(ANSWERS).map((a) => a.field),
);

/** Trimmed, lower-cased, trailing punctuation dropped. */
function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s.!]+$/, '');
}

/** "yes", "Yes.", "done", "ok" — the answer says it was followed. */
export function isAffirmative(value: string | null | undefined): boolean {
  return /^(yes|y|yeah|yep|done|ok|okay|followed|true)\b/.test(normalized(value));
}

/**
 * "no", "No - drain blocked", "not done" — the answer reports a problem.
 * "N/A" is not one: the question did not apply that day.
 */
export function isNegative(value: string | null | undefined): boolean {
  return /^(no|not|nope)\b/.test(normalized(value));
}

/** "21 imgs", "1 img". */
export function imagesLabel(count: number): string {
  return `${count} ${count === 1 ? 'img' : 'imgs'}`;
}

@Injectable()
export class KitchenLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.kitchen',
    name: 'Kitchen Checklist',
    description: 'Every Kitchen Checklist submitted in the period, newest first.',
    domain: 'tasks',
    scope: 'branch',
    // A branch files one a day, so a period's log is short enough to send whole.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      ...Object.entries(ANSWERS).map(([key, a]) => ({ key, label: a.label, type: 'string' as const })),
      { key: 'images', label: 'Images', type: 'string' },
    ],
    drilldown: { id_key: 'task_id', path: '/tasks/:id' },
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, KITCHEN.name);
    const photos = await photoCounts(
      this.prisma,
      forms.submissions.map((s) => s.task_id),
    );

    let withImages = 0;
    let hygieneIssues = 0;
    let fifoFollowed = 0;
    // Newest first, as the screen lists them.
    const rows = [...forms.submissions].reverse().map((s) => {
      const answer = (field: string) => displayAnswer(forms.answers.get(s.task_id)?.get(field));
      const images = photos.get(s.task_id) ?? 0;
      if (images > 0) withImages += 1;
      if (isNegative(answer(ANSWERS.hygiene.field))) hygieneIssues += 1;
      if (isAffirmative(answer(ANSWERS.fifo.field))) fifoFollowed += 1;
      return {
        task_id: s.task_id,
        date: dayLabel(toLocalDateString(s.report_date)),
        submitted_by: s.submitted_by,
        submitted_at: instantLabel(s.completed_at, query.ctx.timezone),
        ...Object.fromEntries(Object.entries(ANSWERS).map(([key, a]) => [key, answer(a.field)])),
        images: imagesLabel(images),
      };
    });

    return {
      rows,
      total: rows.length,
      metrics: [
        { key: 'total_checklists', label: 'Total Checklists', value: rows.length, type: 'number' },
        { key: 'with_images', label: 'With Images', value: withImages, type: 'number' },
        { key: 'hygiene_issues', label: 'Hygiene Issues', value: hygieneIssues, type: 'number' },
        { key: 'fifo_followed', label: 'FIFO Followed', value: fifoFollowed, type: 'number' },
      ],
    };
  }
}

/** Whether the Kitchen Checklist was filed each day, per person responsible. */
@Injectable()
export class KitchenComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.kitchen_compliance',
    name: 'Kitchen Checklist Submission Compliance',
    description: 'Whether the Kitchen Checklist was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, KITCHEN.name);
  }
}
