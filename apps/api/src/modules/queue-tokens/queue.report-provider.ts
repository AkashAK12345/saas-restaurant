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
 * Queue reporting.
 *
 * Lives in the queue module because it is queue knowledge: which statuses are
 * terminal, that a token's day is its `service_date` (already branch-local, so
 * a report never re-derives one), and that "wait" means registration to
 * seating. A central reporting service holding this SQL would have to learn
 * every domain's rules.
 *
 * Both reports filter on `service_date` between the range's branch-local
 * dates, which is exactly the (branch_id, service_date, status) index the
 * queue already carries — no new index needed for either.
 *
 * NO CUSTOMER PII. A queue report is about throughput; it exposes token
 * numbers, party sizes and times, never who was waiting.
 */

const SUMMARY_COLUMNS = [
  { key: 'service_date', label: 'Date', type: 'date' },
  { key: 'registered', label: 'Registered', type: 'number' },
  { key: 'seated', label: 'Seated', type: 'number' },
  { key: 'no_show', label: 'No-show', type: 'number' },
  { key: 'cancelled', label: 'Cancelled', type: 'number' },
  { key: 'avg_wait_seconds', label: 'Average wait', type: 'duration' },
] as const;

const TOKEN_COLUMNS = [
  { key: 'service_date', label: 'Date', type: 'date' },
  { key: 'token_number', label: 'Token', type: 'number' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'party_size', label: 'Party', type: 'number' },
  { key: 'adults', label: 'Adults', type: 'number' },
  { key: 'kids', label: 'Kids', type: 'number' },
  { key: 'table_label', label: 'Table', type: 'string' },
  { key: 'registered_at', label: 'Registered', type: 'datetime' },
  { key: 'called_at', label: 'Called', type: 'datetime' },
  { key: 'seated_at', label: 'Seated', type: 'datetime' },
  { key: 'wait_seconds', label: 'Wait', type: 'duration' },
] as const;

const QUEUE_STATUSES = ['WAITING', 'CALLED', 'SEATED', 'NO_SHOW', 'CANCELLED'] as const;

interface SummaryRow {
  service_date: Date;
  registered: bigint;
  seated: bigint;
  no_show: bigint;
  cancelled: bigint;
  avg_wait_seconds: number | null;
}

interface TokenRow {
  service_date: Date;
  token_number: number;
  status: string;
  party_size: number;
  adults: number;
  kids: number;
  table_label: string | null;
  registered_at: Date;
  called_at: Date | null;
  seated_at: Date | null;
  wait_seconds: number | null;
}

@Injectable()
export class QueueSummaryReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'queue.summary',
    name: 'Queue summary',
    description:
      'Tokens registered, seated, no-show and cancelled per service date, with average wait.',
    domain: 'queue',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    columns: SUMMARY_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range }: ReportQuery): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        "service_date",
        COUNT(*)                                       AS "registered",
        COUNT(*) FILTER (WHERE "status" = 'SEATED')    AS "seated",
        COUNT(*) FILTER (WHERE "status" = 'NO_SHOW')   AS "no_show",
        COUNT(*) FILTER (WHERE "status" = 'CANCELLED') AS "cancelled",
        AVG(EXTRACT(EPOCH FROM ("seated_at" - "created_at")))
          FILTER (WHERE "seated_at" IS NOT NULL)       AS "avg_wait_seconds"
      FROM "queue_tokens"
      WHERE "branch_id" = ${ctx.branchId}::uuid
        AND "company_id" = ${ctx.companyId}::uuid
        AND "service_date" >= ${range.fromLocal}::date
        AND "service_date" <= ${range.toLocal}::date
      GROUP BY "service_date"
      ORDER BY "service_date" DESC
    `);

    let registered = 0;
    let seated = 0;
    let noShow = 0;
    let cancelled = 0;
    let waitTotal = 0;
    let waitCount = 0;

    const shaped = rows.map((row) => {
      const dayRegistered = toReportNumber(row.registered);
      const daySeated = toReportNumber(row.seated);
      const dayNoShow = toReportNumber(row.no_show);
      const dayCancelled = toReportNumber(row.cancelled);

      registered += dayRegistered;
      seated += daySeated;
      noShow += dayNoShow;
      cancelled += dayCancelled;

      // Weight each day's average by the seatings behind it, so a quiet day
      // with one long wait cannot distort the period average.
      if (row.avg_wait_seconds !== null && daySeated > 0) {
        waitTotal += Number(row.avg_wait_seconds) * daySeated;
        waitCount += daySeated;
      }

      return {
        service_date: toLocalDateString(row.service_date),
        registered: dayRegistered,
        seated: daySeated,
        no_show: dayNoShow,
        cancelled: dayCancelled,
        avg_wait_seconds:
          toDurationSeconds(row.avg_wait_seconds),
      };
    });

    return {
      rows: shaped,
      total: shaped.length,
      metrics: [
        { key: 'registered', label: 'Tokens registered', value: registered, type: 'number' },
        { key: 'seated', label: 'Seated', value: seated, type: 'number' },
        { key: 'no_show', label: 'No-shows', value: noShow, type: 'number' },
        { key: 'cancelled', label: 'Cancelled', value: cancelled, type: 'number' },
        {
          key: 'seated_rate',
          label: 'Seated rate',
          value: registered === 0 ? 0 : Math.round((seated / registered) * 100),
          type: 'percent',
        },
        {
          key: 'avg_wait_seconds',
          label: 'Average wait',
          value: waitCount === 0 ? null : Math.round(waitTotal / waitCount),
          type: 'duration',
        },
      ],
    };
  }
}

@Injectable()
export class QueueTokensReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'queue.tokens',
    name: 'Queue tokens',
    description: 'Every token issued in the period, with its outcome and how long it waited.',
    domain: 'queue',
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    columns: TOKEN_COLUMNS,
    options: [{ key: 'status', label: 'Status', values: QUEUE_STATUSES }],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range, options, page }: ReportQuery): Promise<ReportResult> {
    // The status value is already allow-listed by ReportsService against the
    // definition above, and still travels as a bound parameter.
    const statusFilter = options.status
      ? Prisma.sql`AND t."status" = ${options.status}::"QueueTokenStatus"`
      : Prisma.empty;

    const where = Prisma.sql`
      WHERE t."branch_id" = ${ctx.branchId}::uuid
        AND t."company_id" = ${ctx.companyId}::uuid
        AND t."service_date" >= ${range.fromLocal}::date
        AND t."service_date" <= ${range.toLocal}::date
        ${statusFilter}
    `;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<TokenRow[]>(Prisma.sql`
        SELECT
          t."service_date",
          t."token_number",
          t."status"::text AS "status",
          t."party_size",
          t."adults",
          t."kids",
          tbl."label"      AS "table_label",
          t."created_at"   AS "registered_at",
          t."called_at",
          t."seated_at",
          EXTRACT(EPOCH FROM (t."seated_at" - t."created_at")) AS "wait_seconds"
        FROM "queue_tokens" t
        LEFT JOIN "tables" tbl ON tbl."id" = t."assigned_table_id"
        ${where}
        ORDER BY t."service_date" DESC, t."token_number" DESC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "total" FROM "queue_tokens" t ${where}
      `),
    ]);

    return {
      rows: rows.map((row) => ({
        ...row,
        service_date: toLocalDateString(row.service_date),
        wait_seconds: toDurationSeconds(row.wait_seconds),
      })),
      total: toReportNumber(counted[0]?.total),
    };
  }
}

/**
 * "How is the queue right now" — the only queue question worth a tile. It
 * ignores the dashboard's date range on purpose (`live: true` tells the UI to
 * say so), because a waiting count for last month is not information.
 */
@Injectable()
export class QueueTodayWidget implements DashboardWidgetProvider {
  readonly definition: DashboardWidgetDefinition = {
    key: 'queue.today',
    title: 'Queue today',
    domain: 'queue',
    display: 'metrics',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    live: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx }: WidgetQuery): Promise<WidgetResult> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        waiting: bigint;
        called: bigint;
        seated: bigint;
        adults: bigint;
        kids: bigint;
        longest_wait: number | null;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "status" = 'WAITING') AS "waiting",
        COUNT(*) FILTER (WHERE "status" = 'CALLED')  AS "called",
        COUNT(*) FILTER (WHERE "status" = 'SEATED')  AS "seated",
        COALESCE(SUM("adults") FILTER (WHERE "status" IN ('WAITING', 'CALLED')), 0) AS "adults",
        COALESCE(SUM("kids")   FILTER (WHERE "status" IN ('WAITING', 'CALLED')), 0) AS "kids",
        MAX(EXTRACT(EPOCH FROM (NOW() - "created_at")))
          FILTER (WHERE "status" IN ('WAITING', 'CALLED')) AS "longest_wait"
      FROM "queue_tokens"
      WHERE "branch_id" = ${ctx.branchId}::uuid
        AND "company_id" = ${ctx.companyId}::uuid
        AND "service_date" = (NOW() AT TIME ZONE ${ctx.timezone})::date
    `);

    const waiting = toReportNumber(row?.waiting);
    return {
      metrics: [
        {
          key: 'waiting',
          label: 'Waiting',
          value: waiting,
          type: 'number',
          emphasis: waiting > 0 ? 'warning' : 'neutral',
        },
        { key: 'called', label: 'Called', value: toReportNumber(row?.called), type: 'number' },
        // The split of everyone still in the queue — what a host needs to
        // match parties to tables, and what the admin display headlines.
        { key: 'adults', label: 'Adults waiting', value: toReportNumber(row?.adults), type: 'number' },
        { key: 'kids', label: 'Kids waiting', value: toReportNumber(row?.kids), type: 'number' },
        { key: 'seated', label: 'Seated today', value: toReportNumber(row?.seated), type: 'number' },
        {
          key: 'longest_wait',
          label: 'Longest wait',
          value: toDurationSeconds(row?.longest_wait),
          type: 'duration',
        },
      ],
    };
  }
}

/** Registers the queue's reports and tile at startup. */
@Injectable()
export class QueueReportRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly dashboard: DashboardService,
    private readonly summary: QueueSummaryReport,
    private readonly tokens: QueueTokensReport,
    private readonly today: QueueTodayWidget,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.summary);
    this.registry.register(this.tokens);
    this.dashboard.register(this.today);
  }
}
