import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { toReportNumber } from '../reports/report-values.js';
import { InventoryService, type InventoryBranch } from './inventory.service.js';
import type {
  ClosingStockQueryDto,
  ComparativeQueryDto,
  ConsolidatedQueryDto,
  MonthlyAvgQueryDto,
  TransfersReportQueryDto,
} from './inventory-reports.dto.js';

const CURRENCY = 'INR';
const num = (v: unknown) => (v === null || v === undefined ? 0 : toReportNumber(v));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Change from A to B as a percentage of A; null when A is nothing. */
export function deltaPercent(a: number, b: number): number | null {
  if (a === 0) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

/** Price per STOCK unit, from a price per purchase unit that holds `conversion` of them. */
export function perStockUnit(priceMinor: number, conversion: number | null): number {
  return priceMinor / (conversion && conversion > 0 ? conversion : 1);
}

/**
 * Inventory's Purchase Reports — five reports over every branch the caller
 * may see (inventory.view there), as the reference lists them:
 *
 *   Monthly Avg Purchase         what was bought in a period, line by line,
 *                                with the averages above it
 *   Comparative Purchase Analysis Period A measured against Period B, per supplier
 *   Head Outlet Consolidated     the period's purchases across all branches,
 *                                by item, supplier or branch
 *   Closing Stock Valuation      stock now × the last price paid for it
 *   Stock Transfers              outlet → outlet, from the stock ledger
 *
 * A purchase counts when it has ARRIVED: a line received on a delivery (or
 * on an order received before deliveries were recorded), dated by that
 * branch's local day. Amounts are quantity × price, before GST.
 */
@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /** The branches a report covers: all visible, or the one asked for if visible. */
  private async branches(companyId: string, userId: string, branchId?: string): Promise<InventoryBranch[]> {
    const visible = await this.inventory.visibleBranches(companyId, userId);
    if (!branchId) return visible;
    const one = visible.filter((b) => b.id === branchId);
    if (!one.length) throw new ForbiddenException('You do not have inventory access at that branch');
    return one;
  }

  private period(from?: string, to?: string) {
    if ((from && !to) || (!from && to)) throw new BadRequestException('Give both dates of the period, or neither');
    if (from && to && from > to) throw new BadRequestException('The period ends before it starts');
  }

  /** What the filters offer: the branches the caller may see, and the active items. */
  async options(companyId: string, userId: string) {
    const branches = await this.inventory.visibleBranches(companyId, userId);
    const items = await this.prisma.inventoryItem.findMany({
      where: { company_id: companyId, is_active: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: 'asc' },
    });
    return { branches: branches.map(({ id, name }) => ({ id, name })), items };
  }

  /**
   * Every received purchase line at `branchIds` in the period (each branch's
   * own days), as a subquery: one row per line, with its net amount.
   */
  private received(companyId: string, branchIds: string[], from?: string, to?: string, itemId?: string): Prisma.Sql {
    const at = Prisma.sql`COALESCE(r."received_at", po."received_at")`;
    const period =
      from && to ? Prisma.sql`AND ((${at} AT TIME ZONE b."timezone")::date BETWEEN ${from}::date AND ${to}::date)` : Prisma.empty;
    const item = itemId ? Prisma.sql`AND poi."inventory_item_id" = ${itemId}::uuid` : Prisma.empty;
    return Prisma.sql`
      SELECT
        poi."id",
        poi."purchase_order_id",
        poi."name",
        poi."quantity",
        poi."unit",
        poi."unit_price_minor",
        ROUND(poi."quantity" * poi."unit_price_minor") AS "net",
        poi."inventory_item_id",
        po."vendor_id",
        v."name" AS "vendor",
        po."branch_id",
        b."name" AS "branch",
        ${at} AS "received_at",
        to_char((${at} AT TIME ZONE b."timezone")::date, 'YYYY-MM-DD') AS "local_date"
      FROM "purchase_order_items" poi
      JOIN "purchase_orders" po ON po."id" = poi."purchase_order_id"
      JOIN "vendors" v ON v."id" = po."vendor_id"
      JOIN "branches" b ON b."id" = po."branch_id"
      LEFT JOIN "purchase_receipts" r ON r."id" = poi."receipt_id"
      WHERE po."company_id" = ${companyId}::uuid
        AND po."branch_id" = ANY(${branchIds}::uuid[])
        AND po."status" <> 'CANCELLED'
        AND (poi."receipt_id" IS NOT NULL OR po."status" = 'RECEIVED')
        AND ${at} IS NOT NULL
        ${period}
        ${item}
    `;
  }

  // ── Monthly Avg Purchase ────────────────────────────────────────────────

  async monthlyAvg(companyId: string, userId: string, q: MonthlyAvgQueryDto) {
    this.period(q.from, q.to);
    const branches = await this.branches(companyId, userId, q.branch_id);
    const lines = this.received(companyId, branches.map((b) => b.id), q.from, q.to, q.item_id);
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;

    const [[t], rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ orders: bigint; qty: unknown; spend: unknown }>>(Prisma.sql`
        SELECT COUNT(*) AS "orders", SUM(l."quantity") AS "qty", SUM(l."net") AS "spend" FROM (${lines}) l
      `),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          local_date: string;
          received_at: Date;
          vendor: string;
          branch: string;
          name: string;
          quantity: unknown;
          unit: string | null;
          unit_price_minor: number;
          net: unknown;
        }>
      >(Prisma.sql`
        SELECT l."id", l."local_date", l."received_at", l."vendor", l."branch", l."name", l."quantity", l."unit",
               l."unit_price_minor", l."net"
        FROM (${lines}) l
        ORDER BY l."received_at" DESC, l."id"
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);
    const orders = num(t?.orders);
    const qty = num(t?.qty);
    const spend = num(t?.spend);
    return {
      summary: {
        orders,
        avg_qty: orders ? round3(qty / orders) : 0,
        avg_price_minor: qty ? Math.round(spend / qty) : 0,
        total_qty: round3(qty),
        total_spend_minor: spend,
        currency: CURRENCY,
      },
      rows: rows.map((r) => ({
        id: r.id,
        date: r.local_date,
        received_at: r.received_at,
        supplier: r.vendor,
        branch: r.branch,
        item: r.name,
        quantity: round3(num(r.quantity)),
        unit: r.unit,
        price_minor: r.unit_price_minor,
        total_minor: num(r.net),
      })),
      meta: { total: orders, limit, offset },
    };
  }

  // ── Comparative Purchase Analysis ───────────────────────────────────────

  async comparative(companyId: string, userId: string, q: ComparativeQueryDto) {
    this.period(q.a_from, q.a_to);
    this.period(q.b_from, q.b_to);
    const ids = (await this.branches(companyId, userId, q.branch_id)).map((b) => b.id);

    // Orders are purchase orders here (one supplier each), not item lines.
    const bySupplier = (from: string, to: string) =>
      this.prisma.$queryRaw<Array<{ vendor_id: string; vendor: string; orders: bigint; spend: unknown }>>(Prisma.sql`
        SELECT l."vendor_id", l."vendor", COUNT(DISTINCT l."purchase_order_id") AS "orders", SUM(l."net") AS "spend"
        FROM (${this.received(companyId, ids, from, to)}) l
        GROUP BY l."vendor_id", l."vendor"
      `);
    const [a, b] = await Promise.all([bySupplier(q.a_from, q.a_to), bySupplier(q.b_from, q.b_to)]);

    const suppliers = new Map<string, { vendor_id: string; name: string; a_spend_minor: number; b_spend_minor: number }>();
    for (const [rows, side] of [
      [a, 'a_spend_minor'],
      [b, 'b_spend_minor'],
    ] as const) {
      for (const r of rows) {
        const row = suppliers.get(r.vendor_id) ?? { vendor_id: r.vendor_id, name: r.vendor, a_spend_minor: 0, b_spend_minor: 0 };
        row[side] = num(r.spend);
        suppliers.set(r.vendor_id, row);
      }
    }
    const total = (rows: typeof a) => ({
      orders: rows.reduce((s, r) => s + num(r.orders), 0),
      spend_minor: rows.reduce((s, r) => s + num(r.spend), 0),
    });
    const ta = total(a);
    const tb = total(b);
    // A is the period looked at, B the one it is measured against: the
    // change is A over B, as the reference reads it (+924.3% = A is ~10× B).
    return {
      a: { from: q.a_from, to: q.a_to, ...ta },
      b: { from: q.b_from, to: q.b_to, ...tb },
      delta_minor: ta.spend_minor - tb.spend_minor,
      delta_pct: deltaPercent(tb.spend_minor, ta.spend_minor),
      currency: CURRENCY,
      // The biggest spend in Period A first.
      suppliers: [...suppliers.values()]
        .map((s) => ({
          ...s,
          delta_minor: s.a_spend_minor - s.b_spend_minor,
          delta_pct: deltaPercent(s.b_spend_minor, s.a_spend_minor),
        }))
        .sort((x, y) => y.a_spend_minor - x.a_spend_minor || y.b_spend_minor - x.b_spend_minor || x.name.localeCompare(y.name)),
    };
  }

  // ── Head Outlet Consolidated ────────────────────────────────────────────

  async consolidated(companyId: string, userId: string, q: ConsolidatedQueryDto) {
    this.period(q.from, q.to);
    const branches = await this.branches(companyId, userId);
    const lines = this.received(companyId, branches.map((b) => b.id), q.from, q.to);
    const group = q.group ?? 'items';
    const itemKey = Prisma.sql`COALESCE(l."inventory_item_id"::text, l."name")`;
    const key = {
      items: { key: itemKey, name: Prisma.sql`l."name"`, unit: Prisma.sql`l."unit"` },
      suppliers: { key: Prisma.sql`l."vendor_id"::text`, name: Prisma.sql`l."vendor"`, unit: Prisma.sql`NULL::text` },
      branches: { key: Prisma.sql`l."branch_id"::text`, name: Prisma.sql`l."branch"`, unit: Prisma.sql`NULL::text` },
    }[group];
    const rows = await this.prisma.$queryRaw<
      Array<{
        key: string;
        name: string;
        unit: string | null;
        orders: bigint;
        items: bigint;
        qty: unknown;
        spend: unknown;
        last_price: number | null;
        last_buy: string | null;
      }>
    >(Prisma.sql`
      SELECT ${key.key} AS "key", ${key.name} AS "name", ${key.unit} AS "unit",
             COUNT(*) AS "orders",
             COUNT(DISTINCT ${itemKey}) AS "items",
             SUM(l."quantity") AS "qty",
             SUM(l."net") AS "spend",
             (ARRAY_AGG(l."unit_price_minor" ORDER BY l."received_at" DESC))[1] AS "last_price",
             MAX(l."local_date") AS "last_buy"
      FROM (${lines}) l
      GROUP BY 1, 2, 3
      ORDER BY SUM(l."net") DESC, 2
    `);

    // A branch's outstanding: what is still owed on the orders it received in the period.
    const outstanding = new Map<string, number>();
    if (group === 'branches') {
      const owed = await this.prisma.$queryRaw<Array<{ branch_id: string; owed: unknown }>>(Prisma.sql`
        SELECT po."branch_id"::text AS "branch_id", SUM(po."total_minor" - po."paid_minor") AS "owed"
        FROM "purchase_orders" po
        WHERE po."id" IN (SELECT DISTINCT l."purchase_order_id" FROM (${lines}) l)
        GROUP BY po."branch_id"
      `);
      for (const o of owed) outstanding.set(o.branch_id, num(o.owed));
    }

    const out = rows.map((r) => ({
      key: r.key,
      name: r.name,
      unit: r.unit,
      orders: num(r.orders),
      // How many different items: for a supplier or a branch.
      items: num(r.items),
      // Quantities and a last price only mean something within one item.
      quantity: group === 'items' ? round3(num(r.qty)) : null,
      last_price_minor: group === 'items' ? r.last_price : null,
      spend_minor: num(r.spend),
      last_buy: r.last_buy,
      outstanding_minor: group === 'branches' ? (outstanding.get(r.key) ?? 0) : null,
    }));
    return {
      group,
      branches: branches.length,
      summary: {
        rows: out.length,
        orders: out.reduce((s, r) => s + r.orders, 0),
        spend_minor: out.reduce((s, r) => s + r.spend_minor, 0),
        currency: CURRENCY,
      },
      rows: out,
    };
  }

  // ── Closing Stock Valuation ─────────────────────────────────────────────

  async closingStock(companyId: string, userId: string, q: ClosingStockQueryDto) {
    const visible = await this.inventory.visibleBranches(companyId, userId);
    const branches = q.branch_id ? visible.filter((b) => b.id === q.branch_id) : visible;
    if (!branches.length) throw new ForbiddenException('You do not have inventory access at that branch');
    const ids = branches.map((b) => b.id);
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    // One row per item at each branch, as the reference lists it.
    const stock = await this.prisma.$queryRaw<Array<{ item_id: string; branch_id: string; qty: unknown }>>(Prisma.sql`
      SELECT m."item_id", m."branch_id", SUM(m."quantity") AS "qty"
      FROM "stock_movements" m
      WHERE m."company_id" = ${companyId}::uuid AND m."branch_id" = ANY(${ids}::uuid[])
      GROUP BY m."item_id", m."branch_id"
      HAVING SUM(m."quantity") <> 0
    `);
    const empty = { summary: { items: 0, total_value_minor: 0, unpriced: 0, currency: CURRENCY }, rows: [] };
    if (!stock.length) return empty;
    const itemIds = [...new Set(stock.map((s) => s.item_id))];
    const needle = q.q?.trim();
    const [items, last] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: {
          id: { in: itemIds },
          ...(needle ? { name: { contains: needle, mode: 'insensitive' as const } } : {}),
        },
        select: {
          id: true,
          name: true,
          unit: true,
          conversion_qty: true,
          purchase_price_minor: true,
          category: { select: { name: true } },
        },
      }),
      // The last price paid for each, at any branch of the company.
      this.prisma.$queryRaw<Array<{ item_id: string; unit_price_minor: number; received_at: Date }>>(Prisma.sql`
        SELECT DISTINCT ON (l."inventory_item_id") l."inventory_item_id" AS "item_id", l."unit_price_minor", l."received_at"
        FROM (${this.received(
          companyId,
          visible.map((b) => b.id),
        )}) l
        WHERE l."inventory_item_id" = ANY(${itemIds}::uuid[])
        ORDER BY l."inventory_item_id", l."received_at" DESC
      `),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const lastPrice = new Map(last.map((l) => [l.item_id, l]));
    const rows = stock
      .filter((s) => itemById.has(s.item_id))
      .map((s) => {
        const i = itemById.get(s.item_id)!;
        const conversion = i.conversion_qty === null ? null : Number(i.conversion_qty);
        const paid = lastPrice.get(i.id);
        // Per stock unit: the last price paid, else the item's list price.
        const price =
          paid !== undefined
            ? perStockUnit(paid.unit_price_minor, conversion)
            : i.purchase_price_minor !== null
              ? perStockUnit(i.purchase_price_minor, conversion)
              : null;
        const qty = round3(num(s.qty));
        return {
          item_id: i.id,
          branch_id: s.branch_id,
          branch: branchName.get(s.branch_id) ?? '',
          name: i.name,
          category: i.category?.name ?? null,
          unit: i.unit,
          quantity: qty,
          price_minor: price === null ? null : Math.round(price),
          price_source: paid !== undefined ? ('last_purchase' as const) : price !== null ? ('item_price' as const) : null,
          last_purchased_at: paid?.received_at ?? null,
          value_minor: price === null ? 0 : Math.round(qty * price),
        };
      })
      .sort((a, b) => b.value_minor - a.value_minor || a.name.localeCompare(b.name) || a.branch.localeCompare(b.branch));
    return {
      summary: {
        items: rows.length,
        total_value_minor: rows.reduce((s, r) => s + r.value_minor, 0),
        unpriced: rows.filter((r) => r.price_minor === null).length,
        currency: CURRENCY,
      },
      rows,
    };
  }

  // ── Stock Transfers ─────────────────────────────────────────────────────

  async transfers(companyId: string, userId: string, q: TransfersReportQueryDto) {
    this.period(q.from, q.to);
    const visible = await this.inventory.visibleBranches(companyId, userId);
    const ids = visible.map((b) => b.id);
    if (q.branch_id && !ids.includes(q.branch_id)) {
      throw new ForbiddenException('You do not have inventory access at that branch');
    }
    const side = q.branch_id
      ? Prisma.sql`AND (t."from_branch_id" = ${q.branch_id}::uuid OR t."to_branch_id" = ${q.branch_id}::uuid)`
      : Prisma.sql`AND (t."from_branch_id" = ANY(${ids}::uuid[]) OR t."to_branch_id" = ANY(${ids}::uuid[]))`;
    const period =
      q.from && q.to
        ? Prisma.sql`AND ((t."created_at" AT TIME ZONE fb."timezone")::date BETWEEN ${q.from}::date AND ${q.to}::date)`
        : Prisma.empty;
    const base = Prisma.sql`
      FROM "stock_transfer_lines" tl
      JOIN "stock_transfers" t ON t."id" = tl."transfer_id"
      JOIN "branches" fb ON fb."id" = t."from_branch_id"
      JOIN "branches" tb ON tb."id" = t."to_branch_id"
      WHERE t."company_id" = ${companyId}::uuid ${side} ${period}
    `;
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;
    const [[t], rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ transfers: bigint; lines: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT t."id") AS "transfers", COUNT(*) AS "lines" ${base}
      `),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          local_date: string;
          created_at: Date;
          number: string;
          from_branch: string;
          to_branch: string;
          name: string;
          quantity: unknown;
          unit: string | null;
          product: boolean;
        }>
      >(Prisma.sql`
        SELECT tl."id", to_char((t."created_at" AT TIME ZONE fb."timezone")::date, 'YYYY-MM-DD') AS "local_date",
               t."created_at", t."number", fb."name" AS "from_branch", tb."name" AS "to_branch",
               tl."name", tl."quantity", tl."unit", (tl."menu_product_id" IS NOT NULL) AS "product"
        ${base}
        ORDER BY t."created_at" DESC, t."number", tl."position"
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);
    return {
      summary: { transfers: num(t?.transfers), lines: num(t?.lines) },
      rows: rows.map((r) => ({
        id: r.id,
        date: r.local_date,
        created_at: r.created_at,
        number: r.number,
        from: r.from_branch,
        to: r.to_branch,
        item: r.name,
        quantity: round3(num(r.quantity)),
        unit: r.unit ?? (r.product ? 'pcs' : null),
        kind: r.product ? ('PRODUCT' as const) : ('RAW' as const),
      })),
      meta: { total: num(t?.lines), limit, offset },
    };
  }
}
