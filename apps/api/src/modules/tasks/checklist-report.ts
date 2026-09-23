import { Prisma } from '@samco/database';
import type { PrismaService } from '../../core/database/prisma.service.js';
import { toLocalDateString, toReportNumber } from '../reports/report-values.js';
import {
  REFERENCE_CHECKLISTS,
  type ReferenceChecklist,
} from './reference-checklists.js';
import type {
  ReportColumn,
  ReportQuery,
  ReportResult,
} from '../reports/report-contract.js';

/**
 * Reading back a daily checklist form — the EOD Report, the Operational
 * Checklist — as two reports: what was filed (a transposed log) and whether
 * it was filed (compliance per person responsible).
 *
 * A submission is a COMPLETED task whose checklist was copied from the
 * company's template of that form: that is how the Quick Access tile
 * provisions it (a daily routine on that template), and the template's name is
 * taken from the reference library rather than typed again. A retired template
 * is renamed on archive, so its old submissions — a different form — stay out.
 *
 * A submission's DAY is the routine occurrence it was filed for (the day being
 * closed), not the instant it was submitted: a report for the 19th handed in at
 * 00:26 on the 20th is the 19th's.
 */

/**
 * The reference form a report reads, checked at load: every label the report
 * reads an answer from must still be on the form, so renaming a question
 * fails loudly at boot instead of quietly zeroing a card.
 */
export function referenceForm(
  key: string,
  labelsRead: readonly string[],
): ReferenceChecklist {
  const form = REFERENCE_CHECKLISTS.find((r) => r.key === key);
  if (!form) throw new Error(`The ${key} reference checklist is missing`);
  for (const label of labelsRead) {
    if (!form.items.some((i) => i.label === label)) {
      throw new Error(`The ${form.name} form no longer has a "${label}" field`);
    }
  }
  return form;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "18 Sep" from a branch-local YYYY-MM-DD — reordering text, no timezone maths. */
export function dayLabel(localDate: string): string {
  const [, month, day] = localDate.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * "18 Sep, 11:48 PM" on the branch's own clock.
 *
 * Formatted HERE, unlike every other report value, because the log is
 * transposed: each column is one submission, each row one field, so a column
 * cannot carry a single type for the frontend to format by. Built from parts
 * rather than a locale's own pattern so "Sep" never becomes "Sept" when ICU
 * changes.
 */
export function instantLabel(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      day: 'numeric',
      month: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}

/** One stored answer, as the checklist item holds it. */
export interface ChecklistAnswer {
  kind: string;
  value: string | null;
  is_done: boolean;
}

/**
 * An answer as the log shows it. A tick or yes/no reads as Yes/No, a rating
 * out of its scale; a blank answer is null, which renders as a dash.
 */
export function displayAnswer(
  answer: ChecklistAnswer | undefined,
): string | null {
  if (!answer) return null;
  if (answer.kind === 'CHECK') return answer.is_done ? 'Yes' : 'No';
  const value = answer.value?.trim() ? answer.value : null;
  if (value === null) return null;
  if (answer.kind === 'YES_NO')
    return value.toUpperCase() === 'YES' ? 'Yes' : 'No';
  if (answer.kind === 'RATING') return `${value}/5`;
  return value;
}

/** The report's day, in SQL — its routine occurrence, else the day it was raised. */
function reportDate(timezone: string) {
  return Prisma.sql`COALESCE(t."routine_occurrence_date", (t."created_at" AT TIME ZONE ${timezone})::date)`;
}

/**
 * This form's tasks at this branch whose day falls in the window. `person` is
 * the user joined as `u` — who submitted it, or who it was assigned to.
 */
function formWindow(
  query: ReportQuery,
  templateName: string,
  person: 'completed_by' | 'assignee_id',
) {
  const { ctx, range } = query;
  const joinOn =
    person === 'completed_by'
      ? Prisma.sql`t."completed_by"`
      : Prisma.sql`t."assignee_id"`;
  return Prisma.sql`
    FROM "tasks" t
    JOIN "checklist_templates" ct ON ct."id" = t."checklist_template_id"
    LEFT JOIN "users" u ON u."id" = ${joinOn}
    WHERE t."branch_id" = ${ctx.branchId}::uuid
      AND t."company_id" = ${ctx.companyId}::uuid
      AND ct."name" = ${templateName}
      AND ${reportDate(ctx.timezone)} >= ${range.fromLocal}::date
      AND ${reportDate(ctx.timezone)} <= ${range.toLocal}::date
  `;
}

/** The joined user's name as the other reports show it, falling back to email. */
const PERSON = Prisma.sql`COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."first_name", u."last_name")), ''), u."email")`;

interface SubmissionRow {
  task_id: string;
  report_date: Date;
  completed_at: Date;
  submitted_by: string | null;
}

interface ItemRow {
  task_id: string;
  label: string;
  kind: string;
  value: string | null;
  is_done: boolean;
  position: number;
}

export interface SubmittedForms {
  /** Oldest first. */
  submissions: SubmissionRow[];
  /** Every non-photo field seen on any submission, in the form's own order. */
  labels: string[];
  /** Task id -> field label -> the stored answer. */
  answers: Map<string, Map<string, ChecklistAnswer>>;
}

/** Every submission of this form in the window, with its answers. */
export async function loadSubmissions(
  prisma: PrismaService,
  query: ReportQuery,
  templateName: string,
): Promise<SubmittedForms> {
  const submissions = await prisma.$queryRaw<SubmissionRow[]>(Prisma.sql`
    SELECT
      t."id"           AS "task_id",
      ${reportDate(query.ctx.timezone)} AS "report_date",
      t."completed_at",
      ${PERSON} AS "submitted_by"
    ${formWindow(query, templateName, 'completed_by')}
      AND t."status" = 'COMPLETED'
    ORDER BY 2 ASC, t."completed_at" ASC, t."id" ASC
  `);

  const ids = submissions.map((s) => s.task_id);
  const items = ids.length
    ? await prisma.$queryRaw<ItemRow[]>(Prisma.sql`
        SELECT "task_id", "label", "kind"::text AS "kind", "value", "is_done", "position"
        FROM "task_checklist_items"
        WHERE "task_id" = ANY(${ids}::uuid[])
        ORDER BY "position" ASC
      `)
    : [];

  // A photo field has no text to show in a grid and is left out; the photos
  // themselves stay on the task.
  const labels: string[] = [];
  const answers = new Map<string, Map<string, ChecklistAnswer>>();
  for (const item of items) {
    if (item.kind === 'PHOTO') continue;
    if (!labels.includes(item.label)) labels.push(item.label);
    const byTask =
      answers.get(item.task_id) ?? new Map<string, ChecklistAnswer>();
    byTask.set(item.label, {
      kind: item.kind,
      value: item.value,
      is_done: item.is_done,
    });
    answers.set(item.task_id, byTask);
  }
  return { submissions, labels, answers };
}

/**
 * The log, transposed: one column per submission (oldest first), one row per
 * field of the form, after when and by whom it was submitted.
 */
export function transposedLog(
  forms: SubmittedForms,
  timezone: string,
): Pick<ReportResult, 'columns' | 'rows' | 'total'> {
  const { submissions, labels, answers } = forms;
  const columns: ReportColumn[] = [
    { key: 'field', label: 'Field', type: 'string' },
    ...submissions.map((s, i) => ({
      key: `c${i}`,
      label: dayLabel(toLocalDateString(s.report_date)),
      type: 'string' as const,
    })),
  ];

  const row = (field: string, cell: (s: SubmissionRow) => string | null) => ({
    field,
    ...Object.fromEntries(submissions.map((s, i) => [`c${i}`, cell(s)])),
  });

  return {
    columns,
    // Nothing filed: no grid at all, rather than a column of field names.
    rows:
      submissions.length === 0
        ? []
        : [
            row('Submitted', (s) => instantLabel(s.completed_at, timezone)),
            row('Submitted by', (s) => s.submitted_by),
            ...labels.map((label) =>
              row(label, (s) =>
                displayAnswer(answers.get(s.task_id)?.get(label)),
              ),
            ),
          ],
    // Entries are submissions, not the form's rows.
    total: submissions.length,
  };
}

/** The log's own columns before a run — one per submission is only known per run. */
export const TRANSPOSED_LOG_COLUMNS: ReportColumn[] = [
  { key: 'field', label: 'Field', type: 'string' },
];

export const COMPLIANCE_COLUMNS: ReportColumn[] = [
  { key: 'staff', label: 'Staff', type: 'string' },
  { key: 'branch_name', label: 'Branch', type: 'string' },
  { key: 'submitted', label: 'Submitted', type: 'string' },
  { key: 'missed', label: 'Missed', type: 'number' },
  { key: 'pending', label: 'Pending', type: 'number' },
  { key: 'compliance', label: 'Compliance', type: 'percent' },
  { key: 'missed_dates', label: 'Missed Dates', type: 'string' },
];

interface ComplianceRow {
  staff: string;
  submitted: bigint;
  missed: bigint;
  pending: bigint;
  missed_dates: Date[] | null;
}

/**
 * Whether the form was filed each day, per person responsible (the task's
 * assignee, which a routine copies from its default assignee; "Unassigned"
 * when nobody is).
 *
 *   submitted — filed, on time or late
 *   missed    — still unfiled and past its deadline (or, with no deadline,
 *               its day is over)
 *   pending   — still unfiled but not yet late: today's, usually
 *
 * Compliance is submitted over what was actually due (submitted + missed), so
 * today's unfiled form does not count against anyone yet. A cancelled
 * occurrence was never expected and counts nowhere.
 *
 * `due_days` is the window's days that are already over — the "7 days" of
 * "1 staff · 7 days" — whether or not anyone was scheduled on them.
 */
export async function runCompliance(
  prisma: PrismaService,
  query: ReportQuery,
  templateName: string,
): Promise<ReportResult> {
  const { ctx, range } = query;
  const date = reportDate(ctx.timezone);
  const today = Prisma.sql`(NOW() AT TIME ZONE ${ctx.timezone})::date`;
  const late = Prisma.sql`(
    (t."due_at" IS NOT NULL AND t."due_at" < NOW())
    OR (t."due_at" IS NULL AND ${date} < ${today})
  )`;
  const open = Prisma.sql`t."status" IN ('PENDING', 'IN_PROGRESS')`;

  const [rows, days] = await Promise.all([
    prisma.$queryRaw<ComplianceRow[]>(Prisma.sql`
      SELECT
        COALESCE(${PERSON}, 'Unassigned') AS "staff",
        COUNT(*) FILTER (WHERE t."status" = 'COMPLETED')         AS "submitted",
        COUNT(*) FILTER (WHERE ${open} AND ${late})               AS "missed",
        COUNT(*) FILTER (WHERE ${open} AND NOT ${late})           AS "pending",
        ARRAY_AGG(${date} ORDER BY ${date}) FILTER (WHERE ${open} AND ${late}) AS "missed_dates"
      ${formWindow(query, templateName, 'assignee_id')}
        AND t."status" <> 'CANCELLED'
      GROUP BY 1
      ORDER BY 1
    `),
    prisma.$queryRaw<Array<{ due_days: number }>>(Prisma.sql`
      SELECT GREATEST(0, LEAST(${range.toLocal}::date + 1, ${today}) - ${range.fromLocal}::date) AS "due_days"
    `),
  ]);

  let submitted = 0;
  let missed = 0;
  let pending = 0;
  const shaped = rows.map((r) => {
    const s = toReportNumber(r.submitted);
    const m = toReportNumber(r.missed);
    const p = toReportNumber(r.pending);
    submitted += s;
    missed += m;
    pending += p;
    const dates = (r.missed_dates ?? []).map((d) =>
      dayLabel(toLocalDateString(d)),
    );
    return {
      staff: r.staff,
      submitted: `${s} of ${s + m}`,
      missed: m,
      pending: p,
      compliance: s + m === 0 ? null : Math.round((s / (s + m)) * 100),
      missed_dates: dates.length ? dates.join(', ') : null,
    };
  });

  // Nothing was due: no rate to invent, and no "0 of 0" to show.
  const anyDue = submitted + missed > 0;
  return {
    rows: shaped,
    total: shaped.length,
    metrics: [
      {
        key: 'compliance',
        label: 'Compliance',
        value: anyDue
          ? Math.round((submitted / (submitted + missed)) * 100)
          : null,
        type: 'percent',
      },
      {
        key: 'submitted',
        label: 'Submitted',
        value: anyDue ? `${submitted} of ${submitted + missed}` : null,
        type: 'string',
      },
      { key: 'missed', label: 'Missed', value: missed, type: 'number' },
      { key: 'pending', label: 'Pending', value: pending, type: 'number' },
      // For the panel's "1 staff · 7 days" line, not a card of its own.
      {
        key: 'staff_count',
        label: 'Staff',
        value: shaped.length,
        type: 'number',
      },
      {
        key: 'due_days',
        label: 'Days due',
        value: toReportNumber(days[0]?.due_days),
        type: 'number',
      },
    ],
  };
}
