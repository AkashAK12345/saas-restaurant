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
 * Purchase Reports — what a branch ordered from its vendors.
 *
 * An order belongs to the window it was placed in, on the branch's clock. A
 * cancelled order was never bought and counts nowhere; an order still to be
 * received is money committed, so it counts. The same four cards head both
 * views, By Vendor and By Item:
 *
 *   Total Amount   — what the orders came to
 *   Total Items    — the lines ordered, across every order
 *   Vendors        — how many vendors were ordered from
 *   WhatsApp Sent  — orders sent to their vendor, of all orders ("3/4")
 *
 * With no orders there is no currency to read, so a zero reads in rupees.
 */

const DEFAULT_CURRENCY = 'INR';

/** This branch's orders placed inside the window, not cancelled, as `po`. */
function ordersIn({ ctx, range }: ReportQuery): Prisma.Sql {
  return Prisma.sql`
    FROM "purchase_orders" po
    WHERE po."company_id" = ${ctx.companyId}::uuid
      AND po."branch_id" = ${ctx.branchId}::uuid
      AND po."ordered_at" >= ${range.from}
      AND po."ordered_at" < ${range.to}
      AND po."status" <> 'CANCELLED'
  `;
}

/** "3/4" — sent, of all. */
export function sentLabel(sent: number, total: number): string {
  return `${sent}/${total}`;
}

async function cards(prisma: PrismaService, query: ReportQuery): Promise<ReportMetric[]> {
  const [t] = await prisma.$queryRaw<
    Array<{ amount: bigint | null; orders: bigint; sent: bigint; vendors: bigint; items: bigint; currency: string | null }>
  >(Prisma.sql`
    SELECT
      SUM(po."total_minor")                                        AS "amount",
      COUNT(*)                                                     AS "orders",
      COUNT(*) FILTER (WHERE po."whatsapp_sent_at" IS NOT NULL)    AS "sent",
      COUNT(DISTINCT po."vendor_id")                               AS "vendors",
      (SELECT COUNT(*) FROM "purchase_order_items" i
        WHERE i."purchase_order_id" IN (SELECT po."id" ${ordersIn(query)})) AS "items",
      MIN(po."currency")                                           AS "currency"
    ${ordersIn(query)}
  `);
  const orders = toReportNumber(t?.orders);
  return [
    {
      key: 'total_amount',
      label: 'Total Amount',
      value: toReportNumber(t?.amount ?? 0),
      type: 'money',
      currency: t?.currency ?? DEFAULT_CURRENCY,
    },
    { key: 'total_items', label: 'Total Items', value: toReportNumber(t?.items), type: 'number' },
    { key: 'vendors', label: 'Vendors', value: toReportNumber(t?.vendors), type: 'number' },
    {
      key: 'whatsapp_sent',
      label: 'WhatsApp Sent',
      value: sentLabel(toReportNumber(t?.sent), orders),
      type: 'string',
    },
    // Not a card; the export's order count.
    { key: 'orders', label: 'Orders', value: orders, type: 'number' },
  ];
}

/** By Vendor: each vendor's orders over the period, biggest spend first. */
@Injectable()
export class PurchaseByVendorReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'purchase.by_vendor',
    name: 'Purchases by Vendor',
    description: 'What was ordered from each vendor in the period, biggest spend first.',
    domain: 'purchase',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.PURCHASE_REPORTS_VIEW,
    columns: [
      { key: 'vendor', label: 'Vendor', type: 'string' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'items', label: 'Items', type: 'number' },
      { key: 'amount_minor', label: 'Amount', type: 'money' },
      { key: 'whatsapp_sent', label: 'WhatsApp Sent', type: 'string' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const [rows, metrics] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ vendor: string; orders: bigint; items: bigint; amount: bigint; sent: bigint; currency: string }>
      >(Prisma.sql`
        SELECT
          v."name" AS "vendor",
          COUNT(*) AS "orders",
          SUM((SELECT COUNT(*) FROM "purchase_order_items" i WHERE i."purchase_order_id" = po."id")) AS "items",
          SUM(po."total_minor") AS "amount",
          COUNT(*) FILTER (WHERE po."whatsapp_sent_at" IS NOT NULL) AS "sent",
          MIN(po."currency") AS "currency"
        FROM (SELECT po.* ${ordersIn(query)}) po
        JOIN "vendors" v ON v."id" = po."vendor_id"
        GROUP BY v."id", v."name"
        ORDER BY 4 DESC, 1
      `),
      cards(this.prisma, query),
    ]);
    return {
      rows: rows.map((r) => ({
        vendor: r.vendor,
        orders: toReportNumber(r.orders),
        items: toReportNumber(r.items),
        amount_minor: toReportNumber(r.amount),
        currency: r.currency,
        whatsapp_sent: sentLabel(toReportNumber(r.sent), toReportNumber(r.orders)),
      })),
      total: rows.length,
      metrics,
    };
  }
}

/** By Item: each item ordered over the period, biggest spend first. */
@Injectable()
export class PurchaseByItemReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'purchase.by_item',
    name: 'Purchases by Item',
    description: 'How much of each item was ordered in the period, and from whom, biggest spend first.',
    domain: 'purchase',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.PURCHASE_REPORTS_VIEW,
    columns: [
      { key: 'item', label: 'Item', type: 'string' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'unit', label: 'Unit', type: 'string' },
      { key: 'amount_minor', label: 'Amount', type: 'money' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'vendors', label: 'Vendors', type: 'string' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const [rows, metrics] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          item: string;
          unit: string | null;
          quantity: Prisma.Decimal;
          amount: bigint;
          orders: bigint;
          vendors: string;
          currency: string;
        }>
      >(Prisma.sql`
        SELECT
          i."name" AS "item",
          i."unit" AS "unit",
          SUM(i."quantity") AS "quantity",
          SUM(i."line_total_minor") AS "amount",
          COUNT(DISTINCT po."id") AS "orders",
          STRING_AGG(DISTINCT v."name", ', ') AS "vendors",
          MIN(po."currency") AS "currency"
        FROM "purchase_order_items" i
        JOIN (SELECT po.* ${ordersIn(query)}) po ON po."id" = i."purchase_order_id"
        JOIN "vendors" v ON v."id" = po."vendor_id"
        -- The same item in two units is two lines: 5 kg and 5 bags do not add.
        GROUP BY i."name", i."unit"
        ORDER BY 4 DESC, 1
      `),
      cards(this.prisma, query),
    ]);
    return {
      rows: rows.map((r) => ({
        item: r.item,
        quantity: toReportNumber(r.quantity),
        unit: r.unit,
        amount_minor: toReportNumber(r.amount),
        currency: r.currency,
        orders: toReportNumber(r.orders),
        vendors: r.vendors,
      })),
      total: rows.length,
      metrics,
    };
  }
}

@Injectable()
export class PurchaseReportRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly byVendor: PurchaseByVendorReport,
    private readonly byItem: PurchaseByItemReport,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.byVendor);
    this.registry.register(this.byItem);
  }
}
