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
import { eachLocalDate } from '../reports/report-range.js';
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

/**
 * Every column the report can show. Fixed and public — `describe()` lists all
 * of these regardless of caller, because naming a column is not exposing a
 * row. The DATA behind `customer_name` and `phone` is what is actually
 * gated, in `run()` below, by narrowing `ReportResult.columns` per caller.
 */
const TOKEN_COLUMNS = [
  { key: 'token_number', label: 'Token', type: 'number' },
  { key: 'customer_name', label: 'Customer', type: 'string' },
  { key: 'phone', label: 'Phone', type: 'string' },
  { key: 'branch_name', label: 'Branch', type: 'string' },
  { key: 'adults', label: 'Adults', type: 'number' },
  { key: 'kids', label: 'Kids', type: 'number' },
  { key: 'party_size', label: 'PAX', type: 'number' },
  { key: 'registered_at', label: 'Registered', type: 'datetime' },
  { key: 'status', label: 'Status', type: 'badge' },
  { key: 'outcome_at', label: 'Outcome', type: 'datetime' },
  { key: 'wait_seconds', label: 'Wait/Reason', type: 'duration' },
  { key: 'left_at', label: 'Left', type: 'datetime' },
  { key: 'dining_seconds', label: 'Dining time', type: 'duration' },
  { key: 'operator_email', label: 'Operator', type: 'string' },
  { key: 'table_label', label: 'Table', type: 'string' },
  { key: 'floor', label: 'Floor', type: 'string' },
  { key: 'source', label: 'Source', type: 'string' },
] as const;

/** `TOKEN_COLUMNS` minus the two columns `customers.view` gates. */
const PUBLIC_TOKEN_COLUMNS = TOKEN_COLUMNS.filter(
  (c) => c.key !== 'customer_name' && c.key !== 'phone',
);

const QUEUE_STATUSES = ['SCHEDULED', 'WAITING', 'CALLED', 'SEATED', 'NO_SHOW', 'CANCELLED'] as const;

interface SummaryRow {
  service_date: Date;
  registered: bigint;
  seated: bigint;
  no_show: bigint;
  cancelled: bigint;
  avg_wait_seconds: number | null;
}

interface TokenRow {
  token_number: number;
  customer_name?: string;
  phone?: string;
  status: string;
  party_size: number;
  adults: number;
  kids: number;
  registered_at: Date;
  outcome_at: Date | null;
  wait_seconds: number | null;
  left_at: Date | null;
  dining_seconds: number | null;
  operator_email: string | null;
  table_label: string | null;
  floor: string | null;
  source: string;
}

interface TokenAggregateRow {
  total: bigint;
  total_pax: bigint | number;
  avg_wait_seconds: number | null;
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
    name: 'Queue Reports',
    description: 'Every token issued in the period, with its outcome, wait and who handled it.',
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

    // The same rule the Podium screen already applies to a phone number: a
    // customer's name and phone show only alongside customers.view. Built as
    // a JOIN that is simply never made otherwise, so an ungated caller's
    // query never reads the customers table at all — not a value withheld
    // after the fact, but data that never left Postgres.
    const hasCustomers = ctx.permissions?.has(PERMISSION_KEYS.CUSTOMERS_VIEW) ?? false;
    const customerJoin = hasCustomers
      ? Prisma.sql`LEFT JOIN "customers" c ON c."id" = t."customer_id"`
      : Prisma.empty;
    const customerSelect = hasCustomers
      ? Prisma.sql`COALESCE(c."name", 'Walk-in') AS "customer_name", COALESCE(c."phone", 'N/A') AS "phone",`
      : Prisma.empty;

    const [rows, aggregate] = await Promise.all([
      this.prisma.$queryRaw<TokenRow[]>(Prisma.sql`
        SELECT
          t."token_number",
          ${customerSelect}
          t."status"::text AS "status",
          t."party_size",
          t."adults",
          t."kids",
          t."created_at"    AS "registered_at",
          COALESCE(t."seated_at", t."no_show_at", t."cancelled_at") AS "outcome_at",
          EXTRACT(EPOCH FROM (t."seated_at" - t."created_at")) AS "wait_seconds",
          t."finished_at"   AS "left_at",
          EXTRACT(EPOCH FROM (t."finished_at" - t."seated_at")) AS "dining_seconds",
          u."email"         AS "operator_email",
          tbl."label"       AS "table_label",
          tbl."zone"        AS "floor",
          -- No distinct entry point is tracked yet, so everything that is not
          -- an advance booking is attributed to the Podium — the walk-in path
          -- every visible sample row in the reference design also shows.
          CASE WHEN t."advance_booking_at" IS NOT NULL THEN 'Advance booking' ELSE 'Podium' END AS "source"
        FROM "queue_tokens" t
        -- A party that has left no longer holds its table; the last release
        -- event still names the table it sat at.
        LEFT JOIN LATERAL (
          SELECT (r."metadata"->>'table_id')::uuid AS "table_id"
          FROM "queue_token_events" r
          WHERE r."queue_token_id" = t."id" AND r."event_type" = 'TABLE_RELEASED'
          ORDER BY r."created_at" DESC
          LIMIT 1
        ) released ON t."assigned_table_id" IS NULL
        LEFT JOIN "tables" tbl ON tbl."id" = COALESCE(t."assigned_table_id", released."table_id")
        LEFT JOIN "queue_token_events" e
          ON e."queue_token_id" = t."id" AND e."event_type" = 'REGISTERED'
        LEFT JOIN "users" u ON u."id" = e."actor_user_id"
        ${customerJoin}
        ${where}
        ORDER BY t."service_date" DESC, t."token_number" DESC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `),
      this.prisma.$queryRaw<TokenAggregateRow[]>(Prisma.sql`
        SELECT
          COUNT(*)                        AS "total",
          COALESCE(SUM(t."party_size"), 0) AS "total_pax",
          AVG(EXTRACT(EPOCH FROM (t."seated_at" - t."created_at")))
            FILTER (WHERE t."seated_at" IS NOT NULL) AS "avg_wait_seconds"
        FROM "queue_tokens" t
        ${where}
      `),
    ]);

    const total = toReportNumber(aggregate[0]?.total);
    const totalPax = toReportNumber(aggregate[0]?.total_pax);

    return {
      columns: hasCustomers ? TOKEN_COLUMNS : PUBLIC_TOKEN_COLUMNS,
      rows: rows.map((row) => ({
        ...row,
        wait_seconds: toDurationSeconds(row.wait_seconds),
        dining_seconds: toDurationSeconds(row.dining_seconds),
      })),
      total,
      metrics: [
        { key: 'total_customers', label: 'Total Customers', value: total, type: 'number' },
        {
          key: 'avg_wait_seconds',
          label: 'Avg Wait Time',
          value: toDurationSeconds(aggregate[0]?.avg_wait_seconds),
          type: 'duration',
        },
        { key: 'total_pax', label: 'Total PAX', value: totalPax, type: 'number' },
        {
          key: 'avg_pax',
          label: 'Avg PAX',
          value: total === 0 ? 0 : Math.round(totalPax / total),
          type: 'number',
        },
      ],
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
        total: bigint;
        waiting: bigint;
        called: bigint;
        seated: bigint;
        no_show: bigint;
        adults: bigint;
        kids: bigint;
        longest_wait: number | null;
      }>
    >(Prisma.sql`
      SELECT
        -- Every party that walked in today. A SCHEDULED token has not arrived
        -- yet, so it is not a customer of the day until it checks in.
        COUNT(*) FILTER (WHERE "status" <> 'SCHEDULED') AS "total",
        COUNT(*) FILTER (WHERE "status" = 'NO_SHOW') AS "no_show",
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
        { key: 'total', label: 'Customers today', value: toReportNumber(row?.total), type: 'number' },
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
        { key: 'no_show', label: 'No-shows today', value: toReportNumber(row?.no_show), type: 'number' },
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

interface DailyRow {
  service_date: Date;
  registered: bigint;
  seated: bigint;
  no_show: bigint;
  cancelled: bigint;
}

/** One aggregate over the window, per service date; shared by both period tiles. */
function dailyCounts(prisma: PrismaService, ctx: WidgetQuery['ctx'], range: WidgetQuery['range']) {
  return prisma.$queryRaw<DailyRow[]>(Prisma.sql`
    SELECT
      "service_date",
      COUNT(*) FILTER (WHERE "status" <> 'SCHEDULED') AS "registered",
      COUNT(*) FILTER (WHERE "status" = 'SEATED')     AS "seated",
      COUNT(*) FILTER (WHERE "status" = 'NO_SHOW')    AS "no_show",
      COUNT(*) FILTER (WHERE "status" = 'CANCELLED')  AS "cancelled"
    FROM "queue_tokens"
    WHERE "branch_id" = ${ctx.branchId}::uuid
      AND "company_id" = ${ctx.companyId}::uuid
      AND "service_date" >= ${range.fromLocal}::date
      AND "service_date" <= ${range.toLocal}::date
    GROUP BY "service_date"
  `);
}

/**
 * The queue over the selected period — the rows of the SRS "Queue Overview"
 * matrix. With All branches the per-branch breakdown supplies the columns.
 */
@Injectable()
export class QueueOverviewWidget implements DashboardWidgetProvider {
  readonly definition: DashboardWidgetDefinition = {
    key: 'queue.overview',
    title: 'Queue overview',
    domain: 'queue',
    display: 'metrics',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    live: false,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range }: WidgetQuery): Promise<WidgetResult> {
    const rows = await dailyCounts(this.prisma, ctx, range);
    const sum = (k: keyof Omit<DailyRow, 'service_date'>) => rows.reduce((n, r) => n + toReportNumber(r[k]), 0);
    return {
      metrics: [
        { key: 'registered', label: 'Total walked in', value: sum('registered'), type: 'number' },
        { key: 'seated', label: 'Seated', value: sum('seated'), type: 'number' },
        { key: 'cancelled', label: 'Cancelled', value: sum('cancelled'), type: 'number' },
        { key: 'no_show', label: 'No-shows', value: sum('no_show'), type: 'number' },
      ],
    };
  }
}

/**
 * Daily queue — one point per branch-local date in the window, zeroes
 * included, for the dashboard's bar chart. Counts only; no customer data.
 */
@Injectable()
export class QueueDailyWidget implements DashboardWidgetProvider {
  readonly definition: DashboardWidgetDefinition = {
    key: 'queue.daily',
    title: 'Daily queue',
    domain: 'queue',
    display: 'series',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    live: false,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range }: WidgetQuery): Promise<WidgetResult> {
    const rows = await dailyCounts(this.prisma, ctx, range);
    const byDate = new Map(rows.map((r) => [toLocalDateString(r.service_date), r]));
    const points = eachLocalDate(range).map((date) => {
      const r = byDate.get(date);
      return {
        date,
        values: {
          registered: toReportNumber(r?.registered),
          seated: toReportNumber(r?.seated),
          no_show: toReportNumber(r?.no_show),
          cancelled: toReportNumber(r?.cancelled),
        },
      };
    });
    // No headline figure: a "busiest day" would be summed across branches on
    // the All branches view, and a sum of maxima is not a number that exists.
    return {
      metrics: [],
      series: {
        keys: [
          { key: 'registered', label: 'Walked in' },
          { key: 'seated', label: 'Seated' },
          { key: 'no_show', label: 'No-shows' },
          { key: 'cancelled', label: 'Cancelled' },
        ],
        points,
      },
    };
  }
}

/** Registers the queue's reports and tiles at startup. */
@Injectable()
export class QueueReportRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly dashboard: DashboardService,
    private readonly summary: QueueSummaryReport,
    private readonly tokens: QueueTokensReport,
    private readonly today: QueueTodayWidget,
    private readonly overview: QueueOverviewWidget,
    private readonly daily: QueueDailyWidget,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.summary);
    this.registry.register(this.tokens);
    this.dashboard.register(this.today);
    this.dashboard.register(this.overview);
    this.dashboard.register(this.daily);
  }
}
