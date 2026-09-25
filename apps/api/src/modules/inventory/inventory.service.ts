import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BranchStatus, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toReportNumber } from '../reports/report-values.js';
import { STOCK_DEPARTMENTS } from '../tasks/reference-checklists.js';
import type { InventoryOverviewQueryDto } from './inventory.dto.js';

const DEFAULT_PAGE = 100;
const DEFAULT_CURRENCY = 'INR';

export interface InventoryBranch {
  id: string;
  name: string;
  timezone: string;
}

/** One item at one branch. Null means nothing to show: no movement at all
 *  (stock), or none of that kind in the period (consumed, purchase). */
export interface InventoryCell {
  stock: number | null;
  consumed: number | null;
  purchase: number | null;
}

/**
 * Inventory — the company's products and their stock at each branch.
 *
 * WHICH BRANCHES
 *   Every ACTIVE branch of the company where the caller holds inventory.view,
 *   each proved through the same AuthorizationService check any branch screen
 *   uses. The grid never shows a branch the caller could not open on its own;
 *   holding the right at none of them is a refusal, not an empty grid.
 *
 * WHAT THE NUMBERS ARE
 *   Stock     — every movement of the item at the branch, ever: what is there now.
 *   Consumed  — consumption in the period, as a positive quantity.
 *   Purchase  — purchases received in the period.
 *   A period is read on each branch's own clock. No dates is all time.
 *
 * THE SUMMARY (purchase orders of the branches shown, cancelled ones never)
 *   Purchase     — what orders placed in the period came to.
 *   Outstanding  — what is still owed on every order, whatever the period:
 *                  a debt does not stop being owed because it is old.
 *   Open         — orders placed in the period and not yet received.
 *   Received     — orders placed in the period and received.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** The branches whose inventory the caller may see, by name. */
  async visibleBranches(companyId: string, userId: string): Promise<InventoryBranch[]> {
    const candidates = await this.prisma.branch.findMany({
      where: { company_id: companyId, status: BranchStatus.ACTIVE },
      select: { id: true, name: true, timezone: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const resolved = await Promise.all(
      candidates.map(async (branch) => ({
        branch,
        permissions: await this.authorization.branchPermissionsFor(userId, companyId, branch.id),
      })),
    );
    const visible = resolved.filter((r) => r.permissions?.has(PERMISSION_KEYS.INVENTORY_VIEW)).map((r) => r.branch);
    if (visible.length === 0) {
      throw new ForbiddenException('You do not have inventory access at any branch of this company');
    }
    return visible;
  }

  /** What the three filter dropdowns offer. */
  async filters(companyId: string, userId: string) {
    const branches = await this.visibleBranches(companyId, userId);
    const categories = await this.prisma.inventoryCategory.findMany({
      where: { company_id: companyId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      branches: branches.map(({ id, name }) => ({ id, name })),
      categories,
      departments: [...STOCK_DEPARTMENTS],
    };
  }

  async overview(companyId: string, userId: string, query: InventoryOverviewQueryDto) {
    if ((query.from && !query.to) || (!query.from && query.to)) {
      throw new BadRequestException('Give both from and to, or neither');
    }
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('from must not be after to');
    }

    const visible = await this.visibleBranches(companyId, userId);
    let shown = visible;
    if (query.branch_id) {
      shown = visible.filter((b) => b.id === query.branch_id);
      if (shown.length === 0) throw new ForbiddenException('You do not have inventory access at that branch');
    }
    const branchIds = shown.map((b) => b.id);
    const limit = query.limit ?? DEFAULT_PAGE;
    const offset = query.offset ?? 0;

    const where: Prisma.InventoryItemWhereInput = {
      company_id: companyId,
      is_active: true,
      ...(query.category_id ? { category_id: query.category_id } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.q?.trim() ? { name: { contains: query.q.trim(), mode: 'insensitive' } } : {}),
    };

    const [total, items, summary] = await Promise.all([
      this.prisma.inventoryItem.count({ where }),
      this.prisma.inventoryItem.findMany({
        where,
        select: { id: true, name: true, unit: true, department: true, category: { select: { name: true } } },
        orderBy: [{ name: 'asc' }, { unit: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.summary(companyId, branchIds, query.from, query.to),
    ]);

    const cells = await this.cells(
      items.map((i) => i.id),
      branchIds,
      query.from,
      query.to,
    );

    return {
      branches: shown.map(({ id, name }) => ({ id, name })),
      summary,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category?.name ?? null,
        department: item.department,
        cells: Object.fromEntries(
          branchIds.map((b) => [b, cells.get(`${item.id}:${b}`) ?? { stock: null, consumed: null, purchase: null }]),
        ),
      })),
      meta: { total, limit, offset },
    };
  }

  /** "In the period", on each movement's own branch clock; TRUE for all time. */
  private inPeriod(column: Prisma.Sql, from?: string, to?: string): Prisma.Sql {
    if (!from || !to) return Prisma.sql`TRUE`;
    return Prisma.sql`((${column} AT TIME ZONE b."timezone")::date BETWEEN ${from}::date AND ${to}::date)`;
  }

  private async cells(
    itemIds: string[],
    branchIds: string[],
    from?: string,
    to?: string,
  ): Promise<Map<string, InventoryCell>> {
    if (itemIds.length === 0 || branchIds.length === 0) return new Map();
    const period = this.inPeriod(Prisma.sql`m."occurred_at"`, from, to);
    const rows = await this.prisma.$queryRaw<
      Array<{ item_id: string; branch_id: string; stock: unknown; consumed: unknown; purchase: unknown }>
    >(Prisma.sql`
      SELECT
        m."item_id",
        m."branch_id",
        SUM(m."quantity") AS "stock",
        -SUM(m."quantity") FILTER (WHERE m."kind" = 'CONSUMPTION' AND ${period}) AS "consumed",
        SUM(m."quantity") FILTER (WHERE m."kind" = 'PURCHASE' AND ${period}) AS "purchase"
      FROM "stock_movements" m
      JOIN "branches" b ON b."id" = m."branch_id"
      WHERE m."item_id" = ANY(${itemIds}::uuid[])
        AND m."branch_id" = ANY(${branchIds}::uuid[])
      GROUP BY m."item_id", m."branch_id"
    `);
    const orNull = (v: unknown) => (v === null || v === undefined ? null : toReportNumber(v));
    return new Map(
      rows.map((r) => [
        `${r.item_id}:${r.branch_id}`,
        { stock: orNull(r.stock), consumed: orNull(r.consumed), purchase: orNull(r.purchase) },
      ]),
    );
  }

  private async summary(companyId: string, branchIds: string[], from?: string, to?: string) {
    const period = this.inPeriod(Prisma.sql`po."ordered_at"`, from, to);
    const [t] = await this.prisma.$queryRaw<
      Array<{ purchase: unknown; outstanding: unknown; open: bigint; received: bigint; currency: string | null }>
    >(Prisma.sql`
      SELECT
        SUM(po."total_minor") FILTER (WHERE ${period})                           AS "purchase",
        SUM(po."total_minor" - po."paid_minor")                                  AS "outstanding",
        COUNT(*) FILTER (WHERE po."status" = 'ORDERED' AND ${period})            AS "open",
        COUNT(*) FILTER (WHERE po."status" = 'RECEIVED' AND ${period})           AS "received",
        MIN(po."currency")                                                       AS "currency"
      FROM "purchase_orders" po
      JOIN "branches" b ON b."id" = po."branch_id"
      WHERE po."company_id" = ${companyId}::uuid
        AND po."branch_id" = ANY(${branchIds}::uuid[])
        AND po."status" <> 'CANCELLED'
    `);
    return {
      purchase_minor: toReportNumber(t?.purchase ?? 0),
      outstanding_minor: toReportNumber(t?.outstanding ?? 0),
      open: toReportNumber(t?.open),
      received: toReportNumber(t?.received),
      currency: t?.currency ?? DEFAULT_CURRENCY,
    };
  }
}
