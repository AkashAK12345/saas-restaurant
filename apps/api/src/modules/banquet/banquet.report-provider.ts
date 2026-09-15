import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { ReportRegistry } from '../reports/report-registry.service.js';
import { DashboardService } from '../reports/dashboard.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toReportNumber } from '../reports/report-values.js';
import type {
  ReportDefinition,
  ReportMetric,
  ReportProvider,
  ReportQuery,
  ReportResult,
} from '../reports/report-contract.js';
import type {
  DashboardWidgetDefinition,
  DashboardWidgetProvider,
  WidgetMetric,
  WidgetQuery,
  WidgetResult,
} from '../reports/dashboard-contract.js';

/**
 * Banquet reporting.
 *
 * MONEY STAYS IN INTEGER MINOR UNITS all the way out of the API, exactly as it
 * is stored. Nothing here divides by 100; the export renderer and the frontend
 * each do that once, at the moment of display. A report that returned decimals
 * would be the one place in the system where a fraction could appear.
 *
 * CURRENCY IS NOT ASSUMED. Bookings carry their own ISO code, so anything that
 * adds money up groups by currency and reports each separately rather than
 * summing two different currencies into a meaningless number.
 *
 * A booking's day is the day it is HELD (`starts_at`), not the day it was
 * entered — that is what an operator means by "March's events". Payments are
 * reported on `paid_at` for the same reason.
 */

const BOOKING_COLUMNS = [
  { key: 'starts_at', label: 'Event', type: 'datetime' },
  { key: 'hall_name', label: 'Hall', type: 'string' },
  { key: 'customer_name', label: 'Customer', type: 'string' },
  { key: 'package_name', label: 'Package', type: 'string' },
  { key: 'guest_count', label: 'Guests', type: 'number' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'currency', label: 'Currency', type: 'string' },
  { key: 'total_amount_minor', label: 'Total', type: 'money' },
  { key: 'paid_amount_minor', label: 'Paid', type: 'money' },
  { key: 'balance_minor', label: 'Balance', type: 'money' },
] as const;

const PAYMENT_COLUMNS = [
  { key: 'paid_at', label: 'Paid', type: 'datetime' },
  { key: 'starts_at', label: 'Event', type: 'datetime' },
  { key: 'hall_name', label: 'Hall', type: 'string' },
  { key: 'method', label: 'Method', type: 'string' },
  { key: 'currency', label: 'Currency', type: 'string' },
  { key: 'amount_minor', label: 'Amount', type: 'money' },
] as const;

const BOOKING_STATUSES = ['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;

/** Bookings that still owe money. A cancelled event is not a receivable. */
const OWING_STATUSES = Prisma.sql`('CONFIRMED', 'COMPLETED')`;

interface BookingRow {
  booking_id: string;
  starts_at: Date;
  hall_name: string;
  customer_name: string;
  package_name: string;
  guest_count: number;
  status: string;
  currency: string;
  total_amount_minor: number;
  paid_amount_minor: bigint | null;
}

interface PaymentRow {
  booking_id: string;
  paid_at: Date;
  starts_at: Date;
  hall_name: string;
  method: string | null;
  currency: string;
  amount_minor: number;
}

@Injectable()
export class BanquetBookingsReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'banquet.bookings',
    name: 'Banquet bookings',
    description: 'Events held in the period, with guests, value, amount paid and balance due.',
    domain: 'banquet',
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.BANQUET_VIEW,
    columns: BOOKING_COLUMNS,
    options: [{ key: 'status', label: 'Status', values: BOOKING_STATUSES }],
    exportable: true,
    drilldown: { id_key: 'booking_id', path: '/banquet/:id' },
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range, options, page }: ReportQuery): Promise<ReportResult> {
    const statusFilter = options.status
      ? Prisma.sql`AND b."status" = ${options.status}::"BanquetBookingStatus"`
      : Prisma.empty;

    const where = Prisma.sql`
      WHERE b."branch_id" = ${ctx.branchId}::uuid
        AND b."company_id" = ${ctx.companyId}::uuid
        AND b."starts_at" >= ${range.from}
        AND b."starts_at" < ${range.to}
        ${statusFilter}
    `;

    const [rows, counted, totals] = await Promise.all([
      this.prisma.$queryRaw<BookingRow[]>(Prisma.sql`
        SELECT
          b."id" AS "booking_id",
          b."starts_at",
          COALESCE(b."hall_name", h."name") AS "hall_name",
          c."name"  AS "customer_name",
          b."package_name",
          b."guest_count",
          b."status"::text AS "status",
          b."currency",
          b."total_amount_minor",
          COALESCE((
            SELECT SUM(p."amount_minor") FROM "banquet_payments" p
            WHERE p."booking_id" = b."id"
          ), 0) AS "paid_amount_minor"
        FROM "banquet_bookings" b
        JOIN "banquet_halls" h ON h."id" = b."hall_id"
        JOIN "customers"     c ON c."id" = b."customer_id"
        ${where}
        -- id breaks ties: two events at the same instant must not swap between pages.
        ORDER BY b."starts_at" DESC, b."id" ASC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "total" FROM "banquet_bookings" b ${where}
      `),
      // Metrics cover the whole filtered set, not just the page on screen.
      this.prisma.$queryRaw<
        Array<{ currency: string; bookings: bigint; guests: bigint; booked: bigint; paid: bigint }>
      >(Prisma.sql`
        SELECT
          b."currency",
          COUNT(*)                      AS "bookings",
          COALESCE(SUM(b."guest_count"), 0)        AS "guests",
          COALESCE(SUM(b."total_amount_minor"), 0) AS "booked",
          COALESCE(SUM((
            SELECT COALESCE(SUM(p."amount_minor"), 0) FROM "banquet_payments" p
            WHERE p."booking_id" = b."id"
          )), 0) AS "paid"
        FROM "banquet_bookings" b
        ${where}
        GROUP BY b."currency"
        ORDER BY b."currency"
      `),
    ]);

    const metrics: ReportMetric[] = [
      {
        key: 'bookings',
        label: 'Events',
        value: totals.reduce((sum, t) => sum + toReportNumber(t.bookings), 0),
        type: 'number',
      },
      {
        key: 'guests',
        label: 'Guests',
        value: totals.reduce((sum, t) => sum + toReportNumber(t.guests), 0),
        type: 'number',
      },
    ];
    for (const total of totals) {
      metrics.push(
        {
          key: `booked_${total.currency}`,
          label: `Booked value (${total.currency})`,
          value: toReportNumber(total.booked),
          type: 'money',
          currency: total.currency,
        },
        {
          key: `paid_${total.currency}`,
          label: `Collected (${total.currency})`,
          value: toReportNumber(total.paid),
          type: 'money',
          currency: total.currency,
        },
        {
          key: `balance_${total.currency}`,
          label: `Balance due (${total.currency})`,
          value: toReportNumber(total.booked) - toReportNumber(total.paid),
          type: 'money',
          currency: total.currency,
        },
      );
    }

    return {
      rows: rows.map((row) => {
        const paid = toReportNumber(row.paid_amount_minor);
        return {
          ...row,
          paid_amount_minor: paid,
          balance_minor: row.total_amount_minor - paid,
        };
      }),
      total: toReportNumber(counted[0]?.total),
      metrics,
    };
  }
}

@Injectable()
export class BanquetPaymentsReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'banquet.payments',
    name: 'Banquet payments',
    description: 'Payments received in the period against banquet bookings.',
    domain: 'banquet',
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.BANQUET_VIEW,
    columns: PAYMENT_COLUMNS,
    exportable: true,
    drilldown: { id_key: 'booking_id', path: '/banquet/:id' },
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range, page }: ReportQuery): Promise<ReportResult> {
    // Reads `banquet_payments` directly on (branch_id, paid_at) — the index
    // Phase 10 adds for exactly this query.
    const where = Prisma.sql`
      WHERE p."branch_id" = ${ctx.branchId}::uuid
        AND p."company_id" = ${ctx.companyId}::uuid
        AND p."paid_at" >= ${range.from}
        AND p."paid_at" < ${range.to}
    `;

    const [rows, counted, totals] = await Promise.all([
      this.prisma.$queryRaw<PaymentRow[]>(Prisma.sql`
        SELECT
          p."booking_id",
          p."paid_at",
          b."starts_at",
          COALESCE(b."hall_name", h."name") AS "hall_name",
          p."method",
          p."currency",
          p."amount_minor"
        FROM "banquet_payments" p
        JOIN "banquet_bookings" b ON b."id" = p."booking_id"
        JOIN "banquet_halls"    h ON h."id" = b."hall_id"
        ${where}
        ORDER BY p."paid_at" DESC, p."id" ASC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "total" FROM "banquet_payments" p ${where}
      `),
      this.prisma.$queryRaw<Array<{ currency: string; collected: bigint; payments: bigint }>>(
        Prisma.sql`
          SELECT p."currency", COALESCE(SUM(p."amount_minor"), 0) AS "collected",
                 COUNT(*) AS "payments"
          FROM "banquet_payments" p
          ${where}
          GROUP BY p."currency"
          ORDER BY p."currency"
        `,
      ),
    ]);

    const metrics: ReportMetric[] = [
      {
        key: 'payments',
        label: 'Payments',
        value: totals.reduce((sum, t) => sum + toReportNumber(t.payments), 0),
        type: 'number',
      },
      ...totals.map((total) => ({
        key: `collected_${total.currency}`,
        label: `Collected (${total.currency})`,
        value: toReportNumber(total.collected),
        type: 'money' as const,
        currency: total.currency,
      })),
    ];

    return { rows: rows.map((row) => ({ ...row })), total: toReportNumber(counted[0]?.total), metrics };
  }
}

const OUTSTANDING_COLUMNS = [
  { key: 'starts_at', label: 'Event', type: 'datetime' },
  { key: 'hall_name', label: 'Hall', type: 'string' },
  { key: 'customer_name', label: 'Customer', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'currency', label: 'Currency', type: 'string' },
  { key: 'total_amount_minor', label: 'Total', type: 'money' },
  { key: 'paid_amount_minor', label: 'Paid', type: 'money' },
  { key: 'balance_minor', label: 'Balance due', type: 'money' },
  { key: 'last_paid_at', label: 'Last payment', type: 'datetime' },
] as const;

interface OutstandingRow {
  booking_id: string;
  starts_at: Date;
  hall_name: string;
  customer_name: string;
  status: string;
  currency: string;
  total_amount_minor: number;
  paid_amount_minor: bigint | null;
  last_paid_at: Date | null;
}

/**
 * Money still owed on live events — the reference system's "outstanding
 * payments" view. Only confirmed and completed bookings owe anything; a draft
 * is a quote and a cancelled booking is not a receivable.
 *
 * The date window applies to the EVENT date, so "outstanding for March's
 * events" is one filter. Totals are per currency and never summed across two.
 */
@Injectable()
export class BanquetOutstandingReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'banquet.outstanding',
    name: 'Banquet outstanding balances',
    description: 'Confirmed and completed events in the period that still have a balance to collect.',
    domain: 'banquet',
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.BANQUET_VIEW,
    columns: OUTSTANDING_COLUMNS,
    exportable: true,
    drilldown: { id_key: 'booking_id', path: '/banquet/:id' },
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx, range, page }: ReportQuery): Promise<ReportResult> {
    // The paid figure is summed from the append-only history — the source of
    // truth — rather than read from the stored running total.
    const owing = Prisma.sql`
      FROM "banquet_bookings" b
      JOIN "banquet_halls" h ON h."id" = b."hall_id"
      JOIN "customers"     c ON c."id" = b."customer_id"
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(p."amount_minor"), 0) AS "paid", MAX(p."paid_at") AS "last_paid_at"
        FROM "banquet_payments" p
        WHERE p."booking_id" = b."id"
      ) pay ON TRUE
      WHERE b."branch_id" = ${ctx.branchId}::uuid
        AND b."company_id" = ${ctx.companyId}::uuid
        AND b."status" IN ${OWING_STATUSES}
        AND b."starts_at" >= ${range.from}
        AND b."starts_at" < ${range.to}
        AND b."total_amount_minor" > pay."paid"
    `;

    const [rows, counted, totals] = await Promise.all([
      this.prisma.$queryRaw<OutstandingRow[]>(Prisma.sql`
        SELECT
          b."id" AS "booking_id",
          b."starts_at",
          COALESCE(b."hall_name", h."name") AS "hall_name",
          c."name" AS "customer_name",
          b."status"::text AS "status",
          b."currency",
          b."total_amount_minor",
          pay."paid" AS "paid_amount_minor",
          pay."last_paid_at"
        ${owing}
        ORDER BY b."starts_at" ASC, b."id" ASC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS "total" ${owing}`),
      this.prisma.$queryRaw<Array<{ currency: string; bookings: bigint; balance: bigint }>>(Prisma.sql`
        SELECT b."currency", COUNT(*) AS "bookings",
               COALESCE(SUM(b."total_amount_minor" - pay."paid"), 0) AS "balance"
        ${owing}
        GROUP BY b."currency"
        ORDER BY b."currency"
      `),
    ]);

    const metrics: ReportMetric[] = [
      {
        key: 'bookings',
        label: 'Events owing',
        value: totals.reduce((sum, t) => sum + toReportNumber(t.bookings), 0),
        type: 'number',
      },
      ...totals.map((t) => ({
        key: `balance_${t.currency}`,
        label: `Outstanding (${t.currency})`,
        value: toReportNumber(t.balance),
        type: 'money' as const,
        currency: t.currency,
      })),
    ];

    return {
      rows: rows.map((row) => {
        const paid = toReportNumber(row.paid_amount_minor);
        return { ...row, paid_amount_minor: paid, balance_minor: row.total_amount_minor - paid };
      }),
      total: toReportNumber(counted[0]?.total),
      metrics,
    };
  }
}

/**
 * What is still owed, and what is coming. Both are "right now" questions that
 * a date filter would only make wrong, so the tile is marked live.
 */
@Injectable()
export class BanquetOverviewWidget implements DashboardWidgetProvider {
  /** How far ahead "upcoming" looks. A fortnight is one planning horizon. */
  static readonly UPCOMING_DAYS = 14;

  readonly definition: DashboardWidgetDefinition = {
    key: 'banquet.overview',
    title: 'Banquet',
    domain: 'banquet',
    display: 'metrics',
    permission: PERMISSION_KEYS.BANQUET_VIEW,
    live: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run({ ctx }: WidgetQuery): Promise<WidgetResult> {
    const horizon = new Date(Date.now() + BanquetOverviewWidget.UPCOMING_DAYS * 86_400_000);

    const [upcoming, outstanding] = await Promise.all([
      this.prisma.$queryRaw<Array<{ events: bigint; guests: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "events", COALESCE(SUM("guest_count"), 0) AS "guests"
        FROM "banquet_bookings"
        WHERE "branch_id" = ${ctx.branchId}::uuid
          AND "company_id" = ${ctx.companyId}::uuid
          AND "status" IN ${OWING_STATUSES}
          AND "starts_at" >= NOW()
          AND "starts_at" < ${horizon}
      `),
      this.prisma.$queryRaw<Array<{ currency: string; balance: bigint }>>(Prisma.sql`
        SELECT b."currency",
               SUM(b."total_amount_minor" - COALESCE((
                 SELECT SUM(p."amount_minor") FROM "banquet_payments" p
                 WHERE p."booking_id" = b."id"
               ), 0)) AS "balance"
        FROM "banquet_bookings" b
        WHERE b."branch_id" = ${ctx.branchId}::uuid
          AND b."company_id" = ${ctx.companyId}::uuid
          AND b."status" IN ${OWING_STATUSES}
        GROUP BY b."currency"
        HAVING SUM(b."total_amount_minor" - COALESCE((
          SELECT SUM(p."amount_minor") FROM "banquet_payments" p
          WHERE p."booking_id" = b."id"
        ), 0)) > 0
        ORDER BY b."currency"
      `),
    ]);

    const metrics: WidgetMetric[] = [
      {
        key: 'upcoming_events',
        label: `Events next ${BanquetOverviewWidget.UPCOMING_DAYS} days`,
        value: toReportNumber(upcoming[0]?.events),
        type: 'number',
      },
      {
        key: 'upcoming_guests',
        label: 'Guests expected',
        value: toReportNumber(upcoming[0]?.guests),
        type: 'number',
      },
    ];
    for (const row of outstanding) {
      metrics.push({
        key: `outstanding_${row.currency}`,
        label: `Outstanding (${row.currency})`,
        value: toReportNumber(row.balance),
        type: 'money',
        currency: row.currency,
        emphasis: 'warning',
      });
    }

    return { metrics };
  }
}

/** Registers the banquet reports and tile at startup. */
@Injectable()
export class BanquetReportRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly dashboard: DashboardService,
    private readonly bookings: BanquetBookingsReport,
    private readonly payments: BanquetPaymentsReport,
    private readonly overview: BanquetOverviewWidget,
    private readonly outstanding: BanquetOutstandingReport,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.bookings);
    this.registry.register(this.payments);
    this.registry.register(this.outstanding);
    this.dashboard.register(this.overview);
  }
}
