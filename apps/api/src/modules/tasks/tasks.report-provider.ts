import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { ReportRegistry } from '../reports/report-registry.service.js';
import { DashboardService } from '../reports/dashboard.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import {
  toDurationSeconds,
  toLocalDateString,
  toReportNumber,
} from '../reports/report-values.js';
import type {
  ReportDefinition,
  ReportProvider,
  ReportQuery,
  ReportResult,
} from '../reports/report-contract.js';
import type {
  DashboardWidgetDefinition,
  DashboardWidgetProvider,
  WidgetQuery,
  WidgetResult,
} from '../reports/dashboard-contract.js';

/**
 * Task reporting.
 *
 * Guarded by `tasks.reports.view`, not `tasks.view`: Phase 9 already decided
 * that seeing your own work and seeing how everyone is performing are
 * different privileges, and a report must not be the way around that.
 *
 * A task's day is the BRANCH-LOCAL day it was raised. `created_at` is an
 * instant, so every grouping converts it with the branch's own timezone rather
 * than the server's — a 23:30 task in Kolkata belongs to that day, not the
 * next UTC one.
 *
 * OVERDUE is evaluated against NOW, not against the window: an unfinished task
 * from last month is still overdue today, and pretending otherwise would make
 * the number useless. Cancelled work is excluded from completion rates, since
 * a task nobody was meant to do should not count as one nobody did.
 */

const DAY_COLUMNS = [
  { key: 'day', label: 'Date', type: 'date' },
  { key: 'created', label: 'Created', type: 'number' },
  { key: 'completed', label: 'Completed', type: 'number' },
  { key: 'cancelled', label: 'Cancelled', type: 'number' },
  { key: 'open', label: 'Still open', type: 'number' },
  { key: 'completion_rate', label: 'Completion', type: 'percent' },
] as const;

const ASSIGNEE_COLUMNS = [
  { key: 'assignee_name', label: 'Assignee', type: 'string' },
  { key: 'assigned', label: 'Assigned', type: 'number' },
  { key: 'completed', label: 'Completed', type: 'number' },
  { key: 'overdue', label: 'Overdue now', type: 'number' },
  { key: 'completion_rate', label: 'Completion', type: 'percent' },
  { key: 'avg_completion_seconds', label: 'Average time to complete', type: 'duration' },
] as const;

const ROUTINE_COLUMNS = [
  { key: 'routine_name', label: 'Routine', type: 'string' },
  { key: 'generated', label: 'Occurrences', type: 'number' },
  { key: 'completed', label: 'Completed', type: 'number' },
  { key: 'on_time', label: 'On time', type: 'number' },
  { key: 'late', label: 'Late', type: 'number' },
  { key: 'missed', label: 'Missed', type: 'number' },
  { key: 'completion_rate', label: 'Completion', type: 'percent' },
] as const;

/** Work that is neither done nor called off. */
const OPEN_STATUSES = Prisma.sql`('PENDING', 'IN_PROGRESS')`;

/** One decimal place, matching the rate Phase 9's own summary reports. */
function rate(done: number, of: number): number {
  if (of <= 0) return 0;
  return Math.round((done / of) * 1000) / 10;
}

/**
 * The window every task report shares: raised in this branch, in this period.
 * `created_at` + branch is the (branch_id, created_at) index Phase 10 adds.
 */
function windowFor(companyId: string, branchId: string, from: Date, to: Date) {
  return Prisma.sql`
    WHERE t."branch_id" = ${branchId}::uuid
      AND t."company_id" = ${companyId}::uuid
      AND t."created_at" >= ${from}
      AND t."created_at" < ${to}
  `;
}

interface DayRow {
  day: Date;
  created: bigint;
  completed: bigint;
  cancelled: bigint;
  open: bigint;
}

@Injectable()
export class TaskCompletionReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.completion',
    name: 'Task completion',
    description: 'Tasks raised each day and how many of them were finished.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: DAY_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range }: ReportQuery): Promise<ReportResult> {
    const where = windowFor(ctx.companyId, ctx.branchId, range.from, range.to);

    const [rows, overall] = await Promise.all([
      this.prisma.$queryRaw<DayRow[]>(Prisma.sql`
        SELECT
          (t."created_at" AT TIME ZONE ${ctx.timezone})::date AS "day",
          COUNT(*)                                            AS "created",
          COUNT(*) FILTER (WHERE t."status" = 'COMPLETED')    AS "completed",
          COUNT(*) FILTER (WHERE t."status" = 'CANCELLED')    AS "cancelled",
          COUNT(*) FILTER (WHERE t."status" IN ${OPEN_STATUSES}) AS "open"
        FROM "tasks" t
        ${where}
        GROUP BY 1
        ORDER BY 1 DESC
      `),
      this.prisma.$queryRaw<
        Array<{ overdue: bigint; avg_completion_seconds: number | null }>
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (
            WHERE t."status" IN ${OPEN_STATUSES}
              AND t."due_at" IS NOT NULL
              AND t."due_at" < NOW()
          ) AS "overdue",
          AVG(EXTRACT(EPOCH FROM (t."completed_at" - t."created_at")))
            FILTER (WHERE t."completed_at" IS NOT NULL) AS "avg_completion_seconds"
        FROM "tasks" t
        ${where}
      `),
    ]);

    let created = 0;
    let completed = 0;
    let cancelled = 0;

    const shaped = rows.map((row) => {
      const dayCreated = toReportNumber(row.created);
      const dayCompleted = toReportNumber(row.completed);
      const dayCancelled = toReportNumber(row.cancelled);
      created += dayCreated;
      completed += dayCompleted;
      cancelled += dayCancelled;
      return {
        day: toLocalDateString(row.day),
        created: dayCreated,
        completed: dayCompleted,
        cancelled: dayCancelled,
        open: toReportNumber(row.open),
        completion_rate: rate(dayCompleted, dayCreated - dayCancelled),
      };
    });

    const avg = overall[0]?.avg_completion_seconds;
    return {
      rows: shaped,
      total: shaped.length,
      metrics: [
        { key: 'created', label: 'Tasks created', value: created, type: 'number' },
        { key: 'completed', label: 'Completed', value: completed, type: 'number' },
        { key: 'cancelled', label: 'Cancelled', value: cancelled, type: 'number' },
        {
          key: 'completion_rate',
          label: 'Completion rate',
          value: rate(completed, created - cancelled),
          type: 'percent',
        },
        {
          key: 'overdue',
          label: 'Overdue now',
          value: toReportNumber(overall[0]?.overdue),
          type: 'number',
        },
        {
          key: 'avg_completion_seconds',
          label: 'Average time to complete',
          value: toDurationSeconds(avg),
          type: 'duration',
        },
      ],
    };
  }
}

@Injectable()
export class TaskAssigneeReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.assignee',
    name: 'Tasks by assignee',
    description: 'How much work each person was given in the period and how much they finished.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: ASSIGNEE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range }: ReportQuery): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        assignee_name: string;
        assigned: bigint;
        completed: bigint;
        cancelled: bigint;
        overdue: bigint;
        avg_completion_seconds: number | null;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."first_name", u."last_name")), ''), 'Unassigned')
          AS "assignee_name",
        COUNT(*)                                         AS "assigned",
        COUNT(*) FILTER (WHERE t."status" = 'COMPLETED') AS "completed",
        COUNT(*) FILTER (WHERE t."status" = 'CANCELLED') AS "cancelled",
        COUNT(*) FILTER (
          WHERE t."status" IN ${OPEN_STATUSES}
            AND t."due_at" IS NOT NULL
            AND t."due_at" < NOW()
        ) AS "overdue",
        AVG(EXTRACT(EPOCH FROM (t."completed_at" - t."created_at")))
          FILTER (WHERE t."completed_at" IS NOT NULL) AS "avg_completion_seconds"
      FROM "tasks" t
      LEFT JOIN "users" u ON u."id" = t."assignee_id"
      ${windowFor(ctx.companyId, ctx.branchId, range.from, range.to)}
      GROUP BY 1
      ORDER BY "assigned" DESC, 1 ASC
    `);

    let assigned = 0;
    let completed = 0;

    const shaped = rows.map((row) => {
      const rowAssigned = toReportNumber(row.assigned);
      const rowCompleted = toReportNumber(row.completed);
      assigned += rowAssigned;
      completed += rowCompleted;
      return {
        assignee_name: row.assignee_name,
        assigned: rowAssigned,
        completed: rowCompleted,
        overdue: toReportNumber(row.overdue),
        completion_rate: rate(rowCompleted, rowAssigned - toReportNumber(row.cancelled)),
        avg_completion_seconds:
          toDurationSeconds(row.avg_completion_seconds),
      };
    });

    return {
      rows: shaped,
      total: shaped.length,
      metrics: [
        { key: 'people', label: 'People with work', value: shaped.length, type: 'number' },
        { key: 'assigned', label: 'Tasks assigned', value: assigned, type: 'number' },
        { key: 'completed', label: 'Completed', value: completed, type: 'number' },
      ],
    };
  }
}

@Injectable()
export class TaskRoutineReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.routines',
    name: 'Routine adherence',
    description: 'Occurrences each routine generated in the period, and how many were completed.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: ROUTINE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range }: ReportQuery): Promise<ReportResult> {
    // Routine-generated tasks only: an ad-hoc task has no adherence to report.
    // Compliance, not just completion: a checklist signed off after its
    // submission deadline (due_at) is counted LATE, the reference system's
    // "submitted after time". A task with no deadline cannot be late.
    const rows = await this.prisma.$queryRaw<
      Array<{
        routine_name: string;
        generated: bigint;
        completed: bigint;
        late: bigint;
        cancelled: bigint;
      }>
    >(Prisma.sql`
      SELECT
        r."name"                                         AS "routine_name",
        COUNT(*)                                         AS "generated",
        COUNT(*) FILTER (WHERE t."status" = 'COMPLETED') AS "completed",
        COUNT(*) FILTER (
          WHERE t."status" = 'COMPLETED'
            AND t."due_at" IS NOT NULL
            AND t."completed_at" > t."due_at"
        ) AS "late",
        COUNT(*) FILTER (WHERE t."status" = 'CANCELLED') AS "cancelled"
      FROM "tasks" t
      JOIN "task_routines" r ON r."id" = t."routine_id"
      ${windowFor(ctx.companyId, ctx.branchId, range.from, range.to)}
        AND t."routine_id" IS NOT NULL
      GROUP BY 1
      ORDER BY "generated" DESC, 1 ASC
    `);

    let generated = 0;
    let completed = 0;
    let late = 0;

    const shaped = rows.map((row) => {
      const rowGenerated = toReportNumber(row.generated);
      const rowCompleted = toReportNumber(row.completed);
      const rowCancelled = toReportNumber(row.cancelled);
      const rowLate = toReportNumber(row.late);
      generated += rowGenerated;
      completed += rowCompleted;
      late += rowLate;
      return {
        routine_name: row.routine_name,
        generated: rowGenerated,
        completed: rowCompleted,
        on_time: rowCompleted - rowLate,
        late: rowLate,
        // Anything neither done nor called off is a missed occurrence.
        missed: rowGenerated - rowCompleted - rowCancelled,
        completion_rate: rate(rowCompleted, rowGenerated - rowCancelled),
      };
    });

    return {
      rows: shaped,
      total: shaped.length,
      metrics: [
        { key: 'routines', label: 'Routines run', value: shaped.length, type: 'number' },
        { key: 'generated', label: 'Occurrences', value: generated, type: 'number' },
        { key: 'completed', label: 'Completed', value: completed, type: 'number' },
        { key: 'late', label: 'Completed late', value: late, type: 'number' },
        {
          key: 'completion_rate',
          label: 'Adherence',
          value: rate(completed, generated),
          type: 'percent',
        },
        {
          key: 'on_time_rate',
          label: 'On time',
          value: rate(completed - late, generated),
          type: 'percent',
        },
      ],
    };
  }
}

/** What is open and what is late — the shift-lead's glance. */
@Injectable()
export class TasksOpenWidget implements DashboardWidgetProvider {
  readonly definition: DashboardWidgetDefinition = {
    key: 'tasks.open',
    title: 'Tasks',
    domain: 'tasks',
    display: 'metrics',
    permission: PERMISSION_KEYS.TASKS_VIEW,
    live: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx }: WidgetQuery): Promise<WidgetResult> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ open: bigint; overdue: bigint; due_today: bigint; unassigned: bigint }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE t."status" IN ${OPEN_STATUSES}) AS "open",
        COUNT(*) FILTER (
          WHERE t."status" IN ${OPEN_STATUSES}
            AND t."due_at" IS NOT NULL
            AND t."due_at" < NOW()
        ) AS "overdue",
        COUNT(*) FILTER (
          WHERE t."status" IN ${OPEN_STATUSES}
            AND t."due_at" IS NOT NULL
            AND (t."due_at" AT TIME ZONE ${ctx.timezone})::date
                = (NOW() AT TIME ZONE ${ctx.timezone})::date
        ) AS "due_today",
        COUNT(*) FILTER (
          WHERE t."status" IN ${OPEN_STATUSES} AND t."assignee_id" IS NULL
        ) AS "unassigned"
      FROM "tasks" t
      WHERE t."branch_id" = ${ctx.branchId}::uuid
        AND t."company_id" = ${ctx.companyId}::uuid
        AND t."status" IN ${OPEN_STATUSES}
    `);

    const overdue = toReportNumber(row?.overdue);
    return {
      metrics: [
        { key: 'open', label: 'Open', value: toReportNumber(row?.open), type: 'number' },
        {
          key: 'overdue',
          label: 'Overdue',
          value: overdue,
          type: 'number',
          emphasis: overdue > 0 ? 'danger' : 'positive',
        },
        { key: 'due_today', label: 'Due today', value: toReportNumber(row?.due_today), type: 'number' },
        {
          key: 'unassigned',
          label: 'Unassigned',
          value: toReportNumber(row?.unassigned),
          type: 'number',
        },
      ],
    };
  }
}

/** Registers the task reports and tile at startup. */
@Injectable()
export class TaskReportRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly dashboard: DashboardService,
    private readonly completion: TaskCompletionReport,
    private readonly assignee: TaskAssigneeReport,
    private readonly routines: TaskRoutineReport,
    private readonly open: TasksOpenWidget,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.completion);
    this.registry.register(this.assignee);
    this.registry.register(this.routines);
    this.dashboard.register(this.open);
  }
}
