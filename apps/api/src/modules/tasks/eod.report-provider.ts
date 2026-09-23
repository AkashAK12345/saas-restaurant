import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import {
  COMPLIANCE_COLUMNS,
  TRANSPOSED_LOG_COLUMNS,
  displayAnswer,
  loadSubmissions,
  referenceForm,
  runCompliance,
  transposedLog,
} from './checklist-report.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * EOD reporting — the branch's End-of-Day form, read back. See
 * checklist-report.ts for what counts as a submission and whose day it is.
 */

/** The two answers the complaint cards read. */
const FOOD_LABEL = 'Food Complaint';
const SERVICE_LABEL = 'Service Complaints';
const EOD = referenceForm('eod-report', [FOOD_LABEL, SERVICE_LABEL]);

/**
 * Whether an answer actually reports something. Staff write "NIL", "Nill",
 * "N/A" or "no" when there was nothing to report; counting those as
 * complaints would make every card equal the report total and say nothing.
 */
export function isReported(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const v = value.trim().toLowerCase().replace(/[\s.!]+$/, '').trim();
  if (v === '') return false;
  return !/^(nil+|null|n\/?a|none|no|nothing|-+|—|0|no\s+(complaints?|issues?))$/.test(v);
}

/** The EOD log, transposed: one column per submitted EOD, one row per field. */
@Injectable()
export class EodLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.eod',
    name: 'EOD Reports',
    description: 'Every End-of-Day report submitted in the period, side by side.',
    domain: 'tasks',
    scope: 'branch',
    // Not paginated: its rows are the form's fields, not its submissions.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    // The real columns are one per submission and are only known per run —
    // see ReportResult.columns. This is what describe() can say in advance.
    columns: TRANSPOSED_LOG_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, EOD.name);

    let food = 0;
    let service = 0;
    let either = 0;
    for (const s of forms.submissions) {
      const a = forms.answers.get(s.task_id);
      const hasFood = isReported(displayAnswer(a?.get(FOOD_LABEL)));
      const hasService = isReported(displayAnswer(a?.get(SERVICE_LABEL)));
      if (hasFood) food += 1;
      if (hasService) service += 1;
      if (hasFood || hasService) either += 1;
    }

    return {
      ...transposedLog(forms, query.ctx.timezone),
      metrics: [
        { key: 'total_reports', label: 'Total Reports', value: forms.submissions.length, type: 'number' },
        { key: 'with_complaints', label: 'With Complaints', value: either, type: 'number' },
        { key: 'food_complaints', label: 'Food Complaints', value: food, type: 'number' },
        { key: 'service_issues', label: 'Service Issues', value: service, type: 'number' },
      ],
    };
  }
}

/** Whether the EOD was filed each day, per person responsible. */
@Injectable()
export class EodComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.eod_compliance',
    name: 'EOD Submission Compliance',
    description: 'Whether the End-of-Day report was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, EOD.name);
  }
}
