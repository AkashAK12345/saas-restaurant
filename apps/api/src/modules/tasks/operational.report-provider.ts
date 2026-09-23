import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import {
  COMPLIANCE_COLUMNS,
  TRANSPOSED_LOG_COLUMNS,
  loadSubmissions,
  referenceForm,
  runCompliance,
  transposedLog,
  type SubmittedForms,
} from './checklist-report.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * Operational Checklist reporting — the daily floor audit, read back. See
 * checklist-report.ts for what counts as a submission and whose day it is.
 */

/** The three 1–5 ratings the headline averages read, one per card. */
const RATINGS = {
  avg_security: { label: 'Avg Security', field: 'Overall Rating for security (scale 1-5)' },
  avg_readiness: { label: 'Avg Readiness', field: 'Rate the overall Readiness of the Restaurant' },
  avg_operation: { label: 'Avg Operation', field: 'Rate the overall operation of the restaurant' },
} as const;

const OPERATIONAL = referenceForm(
  'operational-checklist',
  Object.values(RATINGS).map((r) => r.field),
);

/**
 * The mean of one rating over the submissions that gave it, to one decimal.
 * A submission that skipped the rating is not a zero; with no rating at all
 * the card reads 0, as the reference screen shows it.
 */
export function averageRating(forms: SubmittedForms, field: string): number {
  const given: number[] = [];
  for (const s of forms.submissions) {
    const answer = forms.answers.get(s.task_id)?.get(field);
    const value = Number(answer?.value);
    if (answer?.kind === 'RATING' && answer.value && Number.isFinite(value)) given.push(value);
  }
  if (given.length === 0) return 0;
  return Math.round((given.reduce((a, b) => a + b, 0) / given.length) * 10) / 10;
}

/** The Operational Checklist log, transposed: one column per submission. */
@Injectable()
export class OperationalLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.operational',
    name: 'Operational Checklist',
    description: 'Every Operational Checklist submitted in the period, side by side, with its average ratings.',
    domain: 'tasks',
    scope: 'branch',
    // Not paginated: its rows are the form's fields, not its submissions.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: TRANSPOSED_LOG_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, OPERATIONAL.name);
    return {
      ...transposedLog(forms, query.ctx.timezone),
      metrics: [
        { key: 'total_checklists', label: 'Total Checklists', value: forms.submissions.length, type: 'number' },
        ...Object.entries(RATINGS).map(([key, r]) => ({
          key,
          label: r.label,
          value: averageRating(forms, r.field),
          type: 'number' as const,
        })),
      ],
    };
  }
}

/** Whether the Operational Checklist was filed each day, per person responsible. */
@Injectable()
export class OperationalComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.operational_compliance',
    name: 'Operational Checklist Submission Compliance',
    description: 'Whether the Operational Checklist was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, OPERATIONAL.name);
  }
}
