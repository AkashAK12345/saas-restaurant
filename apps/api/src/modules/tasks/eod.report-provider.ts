import { Injectable } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toLocalDateString, toReportNumber } from '../reports/report-values.js';
import { REFERENCE_CHECKLISTS } from './reference-checklists.js';
import type {
  ReportColumn,
  ReportDefinition,
  ReportProvider,
  ReportQuery,
  ReportResult,
} from '../reports/report-contract.js';

/**
 * EOD reporting — the branch's End-of-Day form, read back.
 *
 * An EOD submission is a COMPLETED task whose checklist was copied from the
 * company's "EOD Report" template: that is how the Quick Access tile provisions
 * it (a daily routine on that template), and the name is taken from the
 * reference library below rather than typed again here. A retired template is
 * renamed on archive, so its old submissions — a different form — stay out.
 *
 * A report's DAY is the routine occurrence it was filed for (the day being
 * closed), not the instant it was submitted: an EOD for the 19th handed in at
 * 00:26 on the 20th is the 19th's.
 */
const EOD = REFERENCE_CHECKLISTS.find((r) => r.key === 'eod-report');
if (!EOD) throw new Error('The eod-report reference checklist is missing');
const EOD_TEMPLATE_NAME = EOD.name;

/** The two answers the complaint cards read. Taken from the form definition. */
const FOOD_LABEL = 'Food Complaint';
const SERVICE_LABEL = 'Service Complaints';
for (const label of [FOOD_LABEL, SERVICE_LABEL]) {
  if (!EOD.items.some((i) => i.label === label)) {
    throw new Error(`The EOD form no longer has a "${label}" field`);
  }
}

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18 Sep" from a branch-local YYYY-MM-DD — reordering text, no timezone maths. */
export function dayLabel(localDate: string): string {
  const [, month, day] = localDate.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * "18 Sep, 11:48 PM" on the branch's own clock.
 *
 * Formatted HERE, unlike every other report value, because this grid is
 * transposed: each column is one EOD, each row one field, so a column cannot
 * carry a single type for the frontend to format by. Built from parts rather
 * than a locale's own pattern so "Sep" never becomes "Sept" when ICU changes.
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

/** The report's day, in SQL — its routine occurrence, else the day it was raised. */
function reportDate(timezone: string) {
  return Prisma.sql`COALESCE(t."routine_occurrence_date", (t."created_at" AT TIME ZONE ${timezone})::date)`;
}

/**
 * EOD tasks at this branch whose report day falls in the window. `person` is
 * the user joined as `u` — who submitted it, or who it was assigned to.
 */
function eodWindow(query: ReportQuery, person: 'completed_by' | 'assignee_id') {
  const { ctx, range } = query;
  const joinOn = person === 'completed_by' ? Prisma.sql`t."completed_by"` : Prisma.sql`t."assignee_id"`;
  return Prisma.sql`
    FROM "tasks" t
    JOIN "checklist_templates" ct ON ct."id" = t."checklist_template_id"
    LEFT JOIN "users" u ON u."id" = ${joinOn}
    WHERE t."branch_id" = ${ctx.branchId}::uuid
      AND t."company_id" = ${ctx.companyId}::uuid
      AND ct."name" = ${EOD_TEMPLATE_NAME}
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

/**
 * The EOD log, transposed: one column per submitted EOD (oldest first), one
 * row per field of the form. A photo field has no text to show in a grid and
 * is left out; the photos themselves stay on the task.
 */
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
    columns: [{ key: 'field', label: 'Field', type: 'string' }],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const { ctx } = query;
    const submissions = await this.prisma.$queryRaw<SubmissionRow[]>(Prisma.sql`
      SELECT
        t."id"           AS "task_id",
        ${reportDate(ctx.timezone)} AS "report_date",
        t."completed_at",
        ${PERSON} AS "submitted_by"
      ${eodWindow(query, 'completed_by')}
        AND t."status" = 'COMPLETED'
      ORDER BY 2 ASC, t."completed_at" ASC, t."id" ASC
    `);

    const ids = submissions.map((s) => s.task_id);
    const items = ids.length
      ? await this.prisma.$queryRaw<ItemRow[]>(Prisma.sql`
          SELECT "task_id", "label", "kind"::text AS "kind", "value", "is_done", "position"
          FROM "task_checklist_items"
          WHERE "task_id" = ANY(${ids}::uuid[])
          ORDER BY "position" ASC
        `)
      : [];

    // Field order is the form's own; a label seen on any submission gets a row.
    const labels: string[] = [];
    const answers = new Map<string, Map<string, string | null>>();
    for (const item of items) {
      if (item.kind === 'PHOTO') continue;
      if (!labels.includes(item.label)) labels.push(item.label);
      const answer =
        item.kind === 'CHECK' ? (item.is_done ? 'Yes' : 'No') : item.value?.trim() ? item.value : null;
      const byTask = answers.get(item.task_id) ?? new Map<string, string | null>();
      byTask.set(item.label, answer);
      answers.set(item.task_id, byTask);
    }

    const columns: ReportColumn[] = [
      { key: 'field', label: 'Field', type: 'string' },
      ...submissions.map((s, i) => ({
        key: `c${i}`,
        label: dayLabel(toLocalDateString(s.report_date)),
        type: 'string' as const,
      })),
    ];

    const row = (field: string, cell: (taskId: string) => string | null) => ({
      field,
      ...Object.fromEntries(submissions.map((s, i) => [`c${i}`, cell(s.task_id)])),
    });

    const rows = [
      row('Submitted', (id) => {
        const s = submissions.find((x) => x.task_id === id)!;
        return instantLabel(s.completed_at, ctx.timezone);
      }),
      row('Submitted by', (id) => submissions.find((x) => x.task_id === id)!.submitted_by),
      ...labels.map((label) => row(label, (id) => answers.get(id)?.get(label) ?? null)),
    ];

    let food = 0;
    let service = 0;
    let either = 0;
    for (const s of submissions) {
      const a = answers.get(s.task_id);
      const hasFood = isReported(a?.get(FOOD_LABEL));
      const hasService = isReported(a?.get(SERVICE_LABEL));
      if (hasFood) food += 1;
      if (hasService) service += 1;
      if (hasFood || hasService) either += 1;
    }

    return {
      columns,
      rows,
      // Entries are submissions, not the form's rows.
      total: submissions.length,
      metrics: [
        { key: 'total_reports', label: 'Total Reports', value: submissions.length, type: 'number' },
        { key: 'with_complaints', label: 'With Complaints', value: either, type: 'number' },
        { key: 'food_complaints', label: 'Food Complaints', value: food, type: 'number' },
        { key: 'service_issues', label: 'Service Issues', value: service, type: 'number' },
      ],
    };
  }
}

interface ComplianceRow {
  staff: string;
  submitted: bigint;
  missed: bigint;
  pending: bigint;
  missed_dates: Date[] | null;
}

/**
 * Who filed the EOD, per person responsible (the task's assignee, which a
 * routine copies from its default assignee; "Unassigned" when nobody is).
 *
 *   submitted — filed, on time or late
 *   missed    — still unfiled and past its deadline (or, with no deadline,
 *               its day is over)
 *   pending   — still unfiled but not yet late: today's, usually
 *
 * Compliance is submitted over the days that were actually due (submitted +
 * missed), so today's unfiled report does not count against anyone yet. A
 * cancelled occurrence was never expected and counts nowhere.
 */
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
    columns: [
      { key: 'staff', label: 'Staff', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'submitted', label: 'Submitted', type: 'string' },
      { key: 'missed', label: 'Missed', type: 'number' },
      { key: 'pending', label: 'Pending', type: 'number' },
      { key: 'compliance', label: 'Compliance', type: 'percent' },
      { key: 'missed_dates', label: 'Missed Dates', type: 'string' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const { ctx } = query;
    const date = reportDate(ctx.timezone);
    const late = Prisma.sql`(
      (t."due_at" IS NOT NULL AND t."due_at" < NOW())
      OR (t."due_at" IS NULL AND ${date} < (NOW() AT TIME ZONE ${ctx.timezone})::date)
    )`;
    const open = Prisma.sql`t."status" IN ('PENDING', 'IN_PROGRESS')`;

    const [rows, days] = await Promise.all([
      this.prisma.$queryRaw<ComplianceRow[]>(Prisma.sql`
        SELECT
          COALESCE(${PERSON}, 'Unassigned') AS "staff",
          COUNT(*) FILTER (WHERE t."status" = 'COMPLETED')         AS "submitted",
          COUNT(*) FILTER (WHERE ${open} AND ${late})               AS "missed",
          COUNT(*) FILTER (WHERE ${open} AND NOT ${late})           AS "pending",
          ARRAY_AGG(${date} ORDER BY ${date}) FILTER (WHERE ${open} AND ${late}) AS "missed_dates"
        ${eodWindow(query, 'assignee_id')}
          AND t."status" <> 'CANCELLED'
        GROUP BY 1
        ORDER BY 1
      `),
      this.prisma.$queryRaw<Array<{ due_days: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT ${date}) AS "due_days"
        ${eodWindow(query, 'assignee_id')}
          AND (t."status" = 'COMPLETED' OR (${open} AND ${late}))
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
      const dates = (r.missed_dates ?? []).map((d) => dayLabel(toLocalDateString(d)));
      return {
        staff: r.staff,
        submitted: `${s} of ${s + m}`,
        missed: m,
        pending: p,
        compliance: s + m === 0 ? null : Math.round((s / (s + m)) * 100),
        missed_dates: dates.length ? dates.join(', ') : null,
      };
    });

    return {
      rows: shaped,
      total: shaped.length,
      metrics: [
        {
          key: 'compliance',
          label: 'Compliance',
          value: submitted + missed === 0 ? null : Math.round((submitted / (submitted + missed)) * 100),
          type: 'percent',
        },
        { key: 'submitted', label: 'Submitted', value: `${submitted} of ${submitted + missed}`, type: 'string' },
        { key: 'missed', label: 'Missed', value: missed, type: 'number' },
        { key: 'pending', label: 'Pending', value: pending, type: 'number' },
        // For the panel's "1 staff · 7 days" line, not a card of its own.
        { key: 'staff_count', label: 'Staff', value: shaped.length, type: 'number' },
        { key: 'due_days', label: 'Days due', value: toReportNumber(days[0]?.due_days), type: 'number' },
      ],
    };
  }
}
