import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import {
  COMPLIANCE_COLUMNS,
  referenceForm,
  runCompliance,
  runSubmissionLog,
  submissionLogColumns,
  type AnswerColumns,
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

const ANSWERS: AnswerColumns = {
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
};

const OPENING = referenceForm(
  'opening-checklist',
  Object.values(ANSWERS).map((a) => a.field),
);

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
    columns: submissionLogColumns(ANSWERS),
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runSubmissionLog(this.prisma, query, OPENING.name, ANSWERS);
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
