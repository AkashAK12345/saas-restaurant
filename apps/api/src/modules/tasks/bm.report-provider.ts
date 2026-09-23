import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import {
  COMPLIANCE_COLUMNS,
  fieldsRead,
  referenceForm,
  runCompliance,
  runSubmissionLog,
  submissionLogColumns,
  type AnswerColumns,
  type ChecklistAnswer,
  type SubmittedForms,
} from './checklist-report.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * BM Checklist reporting — the branch manager's daily round, read back. See
 * checklist-report.ts for what counts as a submission and whose day it is.
 *
 * Each submission is scored twice, as the manager's two yes/no blocks: the
 * daily checks (six questions) and the points covered at the briefing (six
 * more). A score is how many were answered Yes — "5/6" — and the cards
 * average each score over the period.
 */

const FIELDS = {
  groomed:
    'Are all the staff well-groomed as per the Samco standards? (clean and ironed uniform, with name badge, well-polished shoes)',
  tvMusic: 'TV & Music is on?',
  onTime: 'Is the scheduled staff present and on time?',
  dining: 'Is the dining area clean and presentable? (Tables, chairs, floors, windows, etc.)',
  equipment: 'Are all equipment and appliances functioning properly? (Lights, air conditioning, POS system)',
  restroom: 'Has the restroom been cleaned & sanitized properly and checklist has been filled?',
} as const;

/** The daily checks, in the form's order. */
const DAILY_CHECKS = Object.values(FIELDS);

/** The briefing points, in the form's order. */
const BRIEFING_POINTS = [
  'Grooming',
  'Cleanliness',
  "Yesterday's Feedback",
  "Day's Special",
  'Menu Knowledge',
  'Staff Concern',
] as const;

type AnswerOf = (field: string) => ChecklistAnswer | undefined;

/** How many of these questions were answered Yes; unanswered is not a Yes. */
export function yesCount(answerOf: AnswerOf, fields: readonly string[]): number {
  return fields.filter((f) => answerOf(f)?.value?.trim().toUpperCase() === 'YES').length;
}

/** "5/6". */
export function scoreLabel(score: number, outOf: number): string {
  return `${score}/${outOf}`;
}

/**
 * A score averaged over the period, to one decimal: "5.6/6". With nothing
 * filed it reads "0/6", as the other checklist screens read an empty average.
 */
export function averageScore(forms: SubmittedForms, fields: readonly string[]): string {
  const scores = forms.submissions.map((s) =>
    yesCount((f) => forms.answers.get(s.task_id)?.get(f), fields),
  );
  const mean = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  return scoreLabel(mean, fields.length);
}

const ANSWERS: AnswerColumns = {
  manager: { label: 'Manager', field: 'Manager Name' },
  daily_score: {
    label: 'Daily Score',
    compute: (answerOf) => scoreLabel(yesCount(answerOf, DAILY_CHECKS), DAILY_CHECKS.length),
  },
  briefing_score: {
    label: 'Briefing Score',
    compute: (answerOf) => scoreLabel(yesCount(answerOf, BRIEFING_POINTS), BRIEFING_POINTS.length),
  },
  staff_groomed: { label: 'Staff Groomed', field: FIELDS.groomed },
  tv_music: { label: 'TV/Music', field: FIELDS.tvMusic },
  staff_on_time: { label: 'Staff On Time', field: FIELDS.onTime },
  dining_clean: { label: 'Dining Clean', field: FIELDS.dining },
  equipment: { label: 'Equipment', field: FIELDS.equipment },
  restroom: { label: 'Restroom', field: FIELDS.restroom },
  remarks: { label: 'Remarks', field: 'Remarks/Comments' },
};

const BM = referenceForm('branch-manager-checklist', [...fieldsRead(ANSWERS), ...BRIEFING_POINTS]);

@Injectable()
export class BmLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.bm',
    name: 'BM Checklist',
    description: "Every BM Checklist submitted in the period, newest first, with the manager's daily and briefing scores.",
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
    return runSubmissionLog(this.prisma, query, BM.name, ANSWERS, (forms) => [
      { key: 'avg_daily', label: 'Avg Daily', value: averageScore(forms, DAILY_CHECKS), type: 'string' },
      { key: 'avg_briefing', label: 'Avg Briefing', value: averageScore(forms, BRIEFING_POINTS), type: 'string' },
    ]);
  }
}

/** Whether the BM Checklist was filed each day, per person responsible. */
@Injectable()
export class BmComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.bm_compliance',
    name: 'BM Checklist Submission Compliance',
    description: 'Whether the BM Checklist was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, BM.name);
  }
}
