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
 * Banquet Opening reporting — the halls' readiness for the day, read back.
 * Laid out as the Branch Head Opening screen is: one row per submission with
 * every answer (the form is short enough to show whole), opening in full from
 * the row. See checklist-report.ts for what counts as a submission.
 */

const ANSWERS: AnswerColumns = {
  party_bookings: { label: 'Party Bookings', field: 'Number of parties (L/D), Pax guarantee & Hall name' },
  hall_clean: { label: 'Hall Clean', field: 'Q1. Is the hall clean and tidy?' },
  toilets: { label: 'Toilets', field: 'Q2. Are the toilets neat and clean?' },
  chair_cloths: { label: 'Chair/Cloths', field: 'Q3. Are chair covers, table cloths & frills clean?' },
  ac: { label: 'AC', field: 'Q4. Are all Banquet Hall ACs working?' },
  room_ac: { label: 'Room AC', field: 'Q5. Are all Banquet Hall Room ACs working?' },
  lights: { label: 'Lights', field: 'Q6. Are all Banquet Hall lights working?' },
  tvs: { label: 'TVs', field: 'Q7. Are all TVs in the Banquet Halls working?' },
  speakers: { label: 'Speakers', field: 'Q8. Are all Speakers in the Banquet Halls working?' },
  amps: { label: 'Amps', field: 'Q9. Are all Amplifiers in the Banquet Halls working?' },
  projectors: { label: 'Projectors', field: 'Q10. Are all Projectors in the Banquet Halls working?' },
  remarks: { label: 'Remarks', field: 'Any additional remarks (optional)' },
};

const BANQUET_OPENING = referenceForm(
  'banquet-opening',
  Object.values(ANSWERS).map((a) => a.field),
);

@Injectable()
export class BanquetOpeningLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.banquet_opening',
    name: 'Banquet Opening',
    description: 'Every Banquet Opening Checklist submitted in the period, newest first.',
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
    return runSubmissionLog(this.prisma, query, BANQUET_OPENING.name, ANSWERS);
  }
}

/** Whether the Banquet Opening Checklist was filed each day, per person responsible. */
@Injectable()
export class BanquetOpeningComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.banquet_opening_compliance',
    name: 'Banquet Opening Submission Compliance',
    description: 'Whether the Banquet Opening Checklist was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, BANQUET_OPENING.name);
  }
}
