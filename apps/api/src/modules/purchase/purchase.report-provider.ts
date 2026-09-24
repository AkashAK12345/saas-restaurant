import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { ReportRegistry } from '../reports/report-registry.service.js';
import { toReportNumber } from '../reports/report-values.js';
import { instantLabel } from '../tasks/checklist-report.js';
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
 * views — By Vendor (each order, with its vendor) and By Item:
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

/**
 * The average price paid per unit, in minor units: what the item came to
 * over how much of it was bought. 0 when nothing was.
 */
export function averageRateMinor(totalMinor: number, quantity: number): number {
  return quantity > 0 ? Math.round(totalMinor / quantity) : 0;
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

/**
 * By Vendor: every purchase order in the period, newest first — who it went
 * to, how it was raised, what it came to, and whether it was received and
 * sent on WhatsApp. The search box narrows it by vendor.
 */
@Injectable()
export class PurchaseByVendorReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'purchase.by_vendor',
    name: 'Purchases by Vendor',
    description: 'Every purchase order in the period, newest first, with its vendor.',
    domain: 'purchase',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.PURCHASE_REPORTS_VIEW,
    columns: [
      { key: 'created_at', label: 'Created At', type: 'string' },
      { key: 'invoice', label: 'Invoice', type: 'string' },
      { key: 'vendor', label: 'Vendor', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'source', label: 'Source', type: 'badge' },
      { key: 'items', label: 'Items', type: 'number' },
      { key: 'total_minor', label: 'Total', type: 'money' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'sent', label: 'Sent', type: 'string' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const [rows, metrics] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          ordered_at: Date;
          po_number: string;
          vendor: string;
          source: string;
          items: bigint;
          total_minor: number;
          currency: string;
          status: string;
          sent: boolean;
        }>
      >(Prisma.sql`
        SELECT
          po."ordered_at",
          po."po_number",
          v."name" AS "vendor",
          po."source",
          (SELECT COUNT(*) FROM "purchase_order_items" i WHERE i."purchase_order_id" = po."id") AS "items",
          po."total_minor",
          po."currency",
          po."status"::text AS "status",
          po."whatsapp_sent_at" IS NOT NULL AS "sent"
        FROM (SELECT po.* ${ordersIn(query)}) po
        JOIN "vendors" v ON v."id" = po."vendor_id"
        ORDER BY po."ordered_at" DESC, po."po_number" DESC
      `),
      cards(this.prisma, query),
    ]);
    return {
      rows: rows.map((r) => ({
        created_at: instantLabel(r.ordered_at, query.ctx.timezone),
        invoice: r.po_number,
        vendor: r.vendor,
        source: r.source,
        items: toReportNumber(r.items),
        total_minor: r.total_minor,
        currency: r.currency,
        status: r.status,
        // Words, so an export reads plainly; the screen draws a tick or cross.
        sent: r.sent ? 'Yes' : 'No',
      })),
      total: rows.length,
      metrics,
    };
  }
}

/**
 * By Item: each item bought in the period, biggest spend first — how much,
 * at what average rate, on how many orders, and when it was last ordered.
 */
@Injectable()
export class PurchaseByItemReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'purchase.by_item',
    name: 'Purchases by Item',
    description: 'How much of each item was bought in the period, at what rate, biggest spend first.',
    domain: 'purchase',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.PURCHASE_REPORTS_VIEW,
    columns: [
      { key: 'item', label: 'Item', type: 'string' },
      { key: 'unit', label: 'Unit', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'total_qty', label: 'Total Qty', type: 'number' },
      { key: 'avg_rate_minor', label: 'Avg Rate', type: 'money' },
      { key: 'total_minor', label: 'Total', type: 'money' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'last_ordered', label: 'Last Ordered', type: 'string' },
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
          last_ordered: Date;
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
          MAX(po."ordered_at") AS "last_ordered",
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
      rows: rows.map((r) => {
        const quantity = toReportNumber(r.quantity);
        const amount = toReportNumber(r.amount);
        return {
          item: r.item,
          unit: r.unit,
          total_qty: quantity,
          avg_rate_minor: averageRateMinor(amount, quantity),
          total_minor: amount,
          currency: r.currency,
          orders: toReportNumber(r.orders),
          last_ordered: instantLabel(r.last_ordered, query.ctx.timezone),
          // Not a column: lets the search box find an item by its vendor.
          vendors: r.vendors,
        };
      }),
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
