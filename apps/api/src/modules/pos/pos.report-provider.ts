import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { ReportRegistry } from '../reports/report-registry.service.js';
import { toReportNumber } from '../reports/report-values.js';
import type {
  ReportDefinition,
  ReportMetric,
  ReportProvider,
  ReportQuery,
  ReportResult,
} from '../reports/report-contract.js';

/**
 * POS Reports — a branch's takings, read from its point-of-sale orders.
 *
 * WHICH ORDERS COUNT
 *   An order belongs to the window it was OPENED in, on the branch's clock:
 *   a bill opened at 11:50 PM and settled after midnight is that evening's.
 *   Revenue is what PAID orders came to; an open order has earned nothing
 *   yet and a cancelled one never will. Cancelled orders still count as
 *   orders — they are what "Cancelled" and the success rate measure.
 *
 * CURRENCY
 *   A branch sells in one currency, carried on each order. With no orders
 *   there is nothing to read it from, so a zero reads in rupees.
 */

const DEFAULT_CURRENCY = 'INR';

/** This branch's orders opened inside the window, as `o`. */
function ordersIn({ ctx, range }: ReportQuery): Prisma.Sql {
  return Prisma.sql`
    FROM "pos_orders" o
    WHERE o."company_id" = ${ctx.companyId}::uuid
      AND o."branch_id" = ${ctx.branchId}::uuid
      AND o."opened_at" >= ${range.from}
      AND o."opened_at" < ${range.to}
  `;
}

/** "12 AM", "7 PM" — an hour of the branch's day. */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The average bill, rounded to whole minor units; 0 with nothing paid. */
export function averageMinor(revenueMinor: number, paidOrders: number): number {
  return paidOrders > 0 ? Math.round(revenueMinor / paidOrders) : 0;
}

/** Paid orders as a share of every order opened, 0 with none. */
export function successRate(paid: number, total: number): number {
  return total > 0 ? Math.round((paid / total) * 100) : 0;
}

interface Totals {
  total: bigint;
  paid: bigint;
  cancelled: bigint;
  dine_in: bigint;
  takeaway: bigint;
  revenue: bigint | null;
  currency: string | null;
}

async function totalsFor(prisma: PrismaService, query: ReportQuery) {
  const [t] = await prisma.$queryRaw<Totals[]>(Prisma.sql`
    SELECT
      COUNT(*)                                                          AS "total",
      COUNT(*) FILTER (WHERE o."status" = 'PAID')                        AS "paid",
      COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')                   AS "cancelled",
      COUNT(*) FILTER (WHERE o."order_type" = 'DINE_IN'  AND o."status" <> 'CANCELLED') AS "dine_in",
      COUNT(*) FILTER (WHERE o."order_type" = 'TAKEAWAY' AND o."status" <> 'CANCELLED') AS "takeaway",
      SUM(o."total_minor") FILTER (WHERE o."status" = 'PAID')           AS "revenue",
      MIN(o."currency")                                                 AS "currency"
    ${ordersIn(query)}
  `);
  return {
    total: toReportNumber(t?.total),
    paid: toReportNumber(t?.paid),
    cancelled: toReportNumber(t?.cancelled),
    dineIn: toReportNumber(t?.dine_in),
    takeaway: toReportNumber(t?.takeaway),
    revenue: toReportNumber(t?.revenue ?? 0),
    currency: t?.currency ?? DEFAULT_CURRENCY,
  };
}

const money = (key: string, label: string, value: number, currency: string): ReportMetric => ({
  key,
  label,
  value,
  type: 'money',
  currency,
});

const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  CASH: 'Cash',
  CARD: 'Card',
  UPI: 'UPI',
  WALLET: 'Wallet',
  OTHER: 'Other',
};

const ORDER_TYPE_LABELS: Readonly<Record<string, string>> = {
  DINE_IN: 'Dine In',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

/** Summary tab: the day's takings, and how they were paid. */
@Injectable()
export class PosSummaryReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'pos.summary',
    name: 'POS Summary',
    description: 'Revenue, orders by type, cancellations and payment methods for the period.',
    domain: 'pos',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.POS_REPORTS_VIEW,
    columns: [
      { key: 'method', label: 'Payment Method', type: 'string' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'amount_minor', label: 'Amount', type: 'money' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const [totals, methods] = await Promise.all([
      totalsFor(this.prisma, query),
      this.prisma.$queryRaw<Array<{ method: string; orders: bigint; amount: bigint; currency: string }>>(Prisma.sql`
        SELECT p."method"::text AS "method",
               COUNT(DISTINCT p."order_id") AS "orders",
               SUM(p."amount_minor") AS "amount",
               MIN(o."currency") AS "currency"
        FROM "pos_payments" p
        JOIN "pos_orders" o ON o."id" = p."order_id"
        WHERE o."id" IN (SELECT o."id" ${ordersIn(query)} AND o."status" = 'PAID')
        GROUP BY p."method"
        ORDER BY 3 DESC, 1
      `),
    ]);

    return {
      rows: methods.map((m) => ({
        method: PAYMENT_LABELS[m.method] ?? m.method,
        orders: toReportNumber(m.orders),
        amount_minor: toReportNumber(m.amount),
        currency: m.currency,
      })),
      total: methods.length,
      metrics: [
        money('total_revenue', 'Total Revenue', totals.revenue, totals.currency),
        { key: 'paid_orders', label: 'Paid Orders', value: totals.paid, type: 'number' },
        { key: 'total_orders', label: 'Total Orders', value: totals.total, type: 'number' },
        { key: 'dine_in', label: 'Dine In', value: totals.dineIn, type: 'number' },
        { key: 'takeaway', label: 'Takeaway', value: totals.takeaway, type: 'number' },
        money('avg_order', 'Avg Order', averageMinor(totals.revenue, totals.paid), totals.currency),
        { key: 'cancelled', label: 'Cancelled', value: totals.cancelled, type: 'number' },
        { key: 'success_rate', label: 'Success Rate', value: successRate(totals.paid, totals.total), type: 'percent' },
      ],
    };
  }
}

interface OrderRow {
  order_number: string;
  opened_at: Date;
  order_type: string;
  table_label: string | null;
  items: bigint | null;
  total_minor: number;
  currency: string;
  payment: string | null;
  status: string;
}

/** Orders tab: every order opened in the period, newest first. */
@Injectable()
export class PosOrdersReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'pos.orders',
    name: 'POS Orders',
    description: 'Every point-of-sale order opened in the period, newest first.',
    domain: 'pos',
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.POS_REPORTS_VIEW,
    columns: [
      { key: 'order_number', label: 'Order', type: 'string' },
      { key: 'opened_at', label: 'Time', type: 'datetime' },
      { key: 'order_type', label: 'Type', type: 'badge' },
      { key: 'table_label', label: 'Table', type: 'string' },
      { key: 'items', label: 'Items', type: 'number' },
      { key: 'total_minor', label: 'Total', type: 'money' },
      { key: 'payment', label: 'Payment', type: 'string' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<OrderRow[]>(Prisma.sql`
        SELECT
          o."order_number",
          o."opened_at",
          o."order_type"::text AS "order_type",
          o."table_label",
          (SELECT SUM(i."quantity") FROM "pos_order_items" i WHERE i."order_id" = o."id") AS "items",
          o."total_minor",
          o."currency",
          (SELECT STRING_AGG(DISTINCT p."method"::text, ',') FROM "pos_payments" p WHERE p."order_id" = o."id") AS "payment",
          o."status"::text AS "status"
        ${ordersIn(query)}
        ORDER BY o."opened_at" DESC, o."order_number" DESC
        LIMIT ${query.page.limit} OFFSET ${query.page.offset}
      `),
      this.prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) AS "n" ${ordersIn(query)}`),
    ]);

    return {
      rows: rows.map((r) => ({
        order_number: r.order_number,
        opened_at: r.opened_at,
        order_type: r.order_type,
        table_label: r.table_label,
        items: toReportNumber(r.items ?? 0),
        total_minor: r.total_minor,
        currency: r.currency,
        payment: r.payment
          ? r.payment
              .split(',')
              .map((m) => PAYMENT_LABELS[m] ?? m)
              .join(', ')
          : null,
        status: r.status,
      })),
      total: toReportNumber(counted[0]?.n),
    };
  }
}

/** Analytics tab: the headline figures, and what sold. */
@Injectable()
export class PosAnalyticsReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'pos.analytics',
    name: 'POS Analytics',
    description: 'Revenue, orders and peak hour for the period, with the items sold.',
    domain: 'pos',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.POS_REPORTS_VIEW,
    columns: [
      { key: 'item', label: 'Item', type: 'string' },
      { key: 'quantity', label: 'Qty Sold', type: 'number' },
      { key: 'revenue_minor', label: 'Revenue', type: 'money' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const tz = query.ctx.timezone;
    const [totals, items, peak] = await Promise.all([
      totalsFor(this.prisma, query),
      this.prisma.$queryRaw<Array<{ item: string; quantity: bigint; revenue: bigint; currency: string }>>(Prisma.sql`
        SELECT i."name" AS "item",
               SUM(i."quantity") AS "quantity",
               SUM(i."line_total_minor") AS "revenue",
               MIN(o."currency") AS "currency"
        FROM "pos_order_items" i
        JOIN "pos_orders" o ON o."id" = i."order_id"
        WHERE o."id" IN (SELECT o."id" ${ordersIn(query)} AND o."status" = 'PAID')
        GROUP BY i."name"
        ORDER BY 2 DESC, 3 DESC, 1
        LIMIT 50
      `),
      // The hour that took the most money; ties go to the earlier hour.
      this.prisma.$queryRaw<Array<{ hour: number }>>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM o."opened_at" AT TIME ZONE ${tz})::int AS "hour"
        ${ordersIn(query)} AND o."status" = 'PAID'
        GROUP BY 1
        ORDER BY SUM(o."total_minor") DESC, 1
        LIMIT 1
      `),
    ]);

    return {
      rows: items.map((i) => ({
        item: i.item,
        quantity: toReportNumber(i.quantity),
        revenue_minor: toReportNumber(i.revenue),
        currency: i.currency,
      })),
      total: items.length,
      metrics: [
        money('revenue', 'Revenue', totals.revenue, totals.currency),
        { key: 'paid_orders', label: 'Paid Orders', value: totals.paid, type: 'number' },
        money('avg_order', 'Avg Order', averageMinor(totals.revenue, totals.paid), totals.currency),
        { key: 'all_orders', label: 'All Orders', value: totals.total, type: 'number' },
        { key: 'cancelled', label: 'Cancelled', value: totals.cancelled, type: 'number' },
        {
          key: 'peak_hour',
          label: 'Peak Hour',
          value: peak[0] ? hourLabel(Number(peak[0].hour)) : null,
          type: 'string',
        },
      ],
    };
  }
}

/** Analytics chart: paid revenue by the hour of the branch's day. */
@Injectable()
export class PosRevenueByHourReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'pos.revenue_by_hour',
    name: 'POS Revenue by Hour',
    description: 'Paid revenue in each hour of the day, over the period.',
    domain: 'pos',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.POS_REPORTS_VIEW,
    columns: [
      { key: 'hour_label', label: 'Hour', type: 'string' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'revenue_minor', label: 'Revenue', type: 'money' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<Array<{ hour: number; orders: bigint; revenue: bigint; currency: string }>>(
      Prisma.sql`
        SELECT EXTRACT(HOUR FROM o."opened_at" AT TIME ZONE ${query.ctx.timezone})::int AS "hour",
               COUNT(*) AS "orders",
               SUM(o."total_minor") AS "revenue",
               MIN(o."currency") AS "currency"
        ${ordersIn(query)} AND o."status" = 'PAID'
        GROUP BY 1
        ORDER BY 1
      `,
    );
    return {
      rows: rows.map((r) => ({
        hour: Number(r.hour),
        hour_label: hourLabel(Number(r.hour)),
        orders: toReportNumber(r.orders),
        revenue_minor: toReportNumber(r.revenue),
        currency: r.currency,
      })),
      total: rows.length,
    };
  }
}

/** Analytics chart: paid revenue by dine-in, takeaway and delivery. */
@Injectable()
export class PosRevenueByTypeReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'pos.revenue_by_type',
    name: 'POS Revenue by Order Type',
    description: 'Paid revenue split by dine-in, takeaway and delivery, over the period.',
    domain: 'pos',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.POS_REPORTS_VIEW,
    columns: [
      { key: 'order_type', label: 'Order Type', type: 'string' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'revenue_minor', label: 'Revenue', type: 'money' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<Array<{ type: string; orders: bigint; revenue: bigint; currency: string }>>(
      Prisma.sql`
        SELECT o."order_type"::text AS "type",
               COUNT(*) AS "orders",
               SUM(o."total_minor") AS "revenue",
               MIN(o."currency") AS "currency"
        ${ordersIn(query)} AND o."status" = 'PAID'
        GROUP BY 1
        ORDER BY 3 DESC, 1
      `,
    );
    return {
      rows: rows.map((r) => ({
        order_type: ORDER_TYPE_LABELS[r.type] ?? r.type,
        orders: toReportNumber(r.orders),
        revenue_minor: toReportNumber(r.revenue),
        currency: r.currency,
      })),
      total: rows.length,
    };
  }
}

@Injectable()
export class PosReportRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly summary: PosSummaryReport,
    private readonly orders: PosOrdersReport,
    private readonly analytics: PosAnalyticsReport,
    private readonly byHour: PosRevenueByHourReport,
    private readonly byType: PosRevenueByTypeReport,
  ) {}

  onModuleInit(): void {
    for (const report of [this.summary, this.orders, this.analytics, this.byHour, this.byType]) {
      this.registry.register(report);
    }
  }
}
