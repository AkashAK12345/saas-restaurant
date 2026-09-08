import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEventType, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { BanquetActorContext, BanquetCompanyContext } from './banquet-context.js';
import type { BanquetHallView, BanquetPackageView } from './banquet-views.js';
import type {
  CreateHallDto,
  CreatePackageDto,
  UpdateHallDto,
  UpdatePackageDto,
} from './banquet.dto.js';
import { assertCurrencyCode } from './banquet-money.js';

const PACKAGE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
} satisfies Prisma.BanquetPackageInclude;

type PackageRecord = Prisma.BanquetPackageGetPayload<{ include: typeof PACKAGE_INCLUDE }>;
type HallRecord = Prisma.BanquetHallGetPayload<object>;

/**
 * The banquet catalogue: halls (branch-scoped, like Table) and packages
 * (company-scoped, like Customer — one catalogue serves every branch).
 *
 * A package is deliberately NOT a Product/Menu system: it prices an event and
 * lists what the kitchen must produce. Phase 2 master data will not be
 * replaced by it.
 */
@Injectable()
export class BanquetCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  // ── Halls ─────────────────────────────────────────────────────────────────

  async listHalls(branchId: string, page: { limit: number; offset: number }): Promise<Paginated<BanquetHallView>> {
    const where = { branch_id: branchId };
    const [rows, total] = await Promise.all([
      this.prisma.banquetHall.findMany({
        where,
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.banquetHall.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toHallView(r)),
      meta: { total, limit: page.limit, offset: page.offset },
    };
  }

  /** Scoped by id AND branch in one query; 404 for anything out of scope. */
  async getHall(hallId: string, branchId: string): Promise<BanquetHallView> {
    const hall = await this.prisma.banquetHall.findFirst({
      where: { id: hallId, branch_id: branchId },
    });
    if (!hall) throw new NotFoundException();
    return this.toHallView(hall);
  }

  async createHall(ctx: BanquetActorContext, dto: CreateHallDto): Promise<BanquetHallView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const hall = await tx.banquetHall.create({
          data: { branch_id: ctx.branchId, name: dto.name, capacity: dto.capacity },
        });
        await this.audit(tx, ctx, AuditEventType.CREATE, 'BANQUET_HALL', hall.id, {
          action: 'create_hall',
          name: dto.name,
          capacity: dto.capacity,
        });
        return this.toHallView(hall);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A hall with this name already exists at this branch');
      }
      throw e;
    }
  }

  async updateHall(
    ctx: BanquetActorContext,
    hallId: string,
    dto: UpdateHallDto,
  ): Promise<BanquetHallView> {
    await this.getHall(hallId, ctx.branchId); // scope check first — 404 hides other branches

    const data: Prisma.BanquetHallUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const hall = await tx.banquetHall.update({ where: { id: hallId }, data });
        await this.audit(tx, ctx, AuditEventType.UPDATE, 'BANQUET_HALL', hallId, {
          action: 'update_hall',
          changed_fields: Object.keys(dto),
        });
        return this.toHallView(hall);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A hall with this name already exists at this branch');
      }
      throw e;
    }
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  async listPackages(
    companyId: string,
    page: { limit: number; offset: number },
  ): Promise<Paginated<BanquetPackageView>> {
    const where = { company_id: companyId };
    const [rows, total] = await Promise.all([
      this.prisma.banquetPackage.findMany({
        where,
        include: PACKAGE_INCLUDE,
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.banquetPackage.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toPackageView(r)),
      meta: { total, limit: page.limit, offset: page.offset },
    };
  }

  async getPackage(packageId: string, companyId: string): Promise<BanquetPackageView> {
    const pkg = await this.prisma.banquetPackage.findFirst({
      where: { id: packageId, company_id: companyId },
      include: PACKAGE_INCLUDE,
    });
    if (!pkg) throw new NotFoundException();
    return this.toPackageView(pkg);
  }

  async createPackage(
    ctx: BanquetCompanyContext,
    dto: CreatePackageDto,
  ): Promise<BanquetPackageView> {
    const currency = assertCurrencyCode(dto.currency);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const pkg = await tx.banquetPackage.create({
          data: {
            company_id: ctx.companyId,
            name: dto.name,
            description: dto.description ?? null,
            price_per_guest_minor: dto.price_per_guest_minor,
            currency,
            items: {
              create: (dto.items ?? []).map((item, index) => ({
                name: item.name,
                position: index,
              })),
            },
          },
          include: PACKAGE_INCLUDE,
        });
        await this.audit(tx, { ...ctx, branchId: null }, AuditEventType.CREATE, 'BANQUET_PACKAGE', pkg.id, {
          action: 'create_package',
          name: dto.name,
          price_per_guest_minor: dto.price_per_guest_minor,
          currency,
          item_count: pkg.items.length,
        });
        return this.toPackageView(pkg);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A package with this name already exists in this company');
      }
      throw e;
    }
  }

  /**
   * Editing a package never rewrites history: every booking carries its own
   * commercial snapshot and its own copy of the component list.
   */
  async updatePackage(
    ctx: BanquetCompanyContext,
    packageId: string,
    dto: UpdatePackageDto,
  ): Promise<BanquetPackageView> {
    await this.getPackage(packageId, ctx.companyId);
    const currency = dto.currency !== undefined ? assertCurrencyCode(dto.currency) : undefined;

    const data: Prisma.BanquetPackageUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price_per_guest_minor !== undefined) {
      data.price_per_guest_minor = dto.price_per_guest_minor;
    }
    if (currency !== undefined) data.currency = currency;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.banquetPackage.update({ where: { id: packageId }, data });

        if (dto.items !== undefined) {
          // Wholesale replacement — package items carry no history of their own.
          await tx.banquetPackageItem.deleteMany({ where: { package_id: packageId } });
          for (const [index, item] of dto.items.entries()) {
            await tx.banquetPackageItem.create({
              data: { package_id: packageId, name: item.name, position: index },
            });
          }
        }

        const pkg = await tx.banquetPackage.findUniqueOrThrow({
          where: { id: packageId },
          include: PACKAGE_INCLUDE,
        });
        await this.audit(tx, { ...ctx, branchId: null }, AuditEventType.UPDATE, 'BANQUET_PACKAGE', packageId, {
          action: 'update_package',
          changed_fields: Object.keys(dto),
        });
        return this.toPackageView(pkg);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A package with this name already exists in this company');
      }
      throw e;
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private audit(
    tx: Prisma.TransactionClient,
    ctx: { companyId: string; branchId?: string | null; actorUserId: string },
    eventType: AuditEventType,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLogService.create(
      {
        actorUserId: ctx.actorUserId,
        companyId: ctx.companyId,
        branchId: ctx.branchId ?? null,
        eventType,
        entityType,
        entityId,
        payload,
      },
      tx,
    );
  }

  private toHallView(hall: HallRecord): BanquetHallView {
    return {
      id: hall.id,
      branch_id: hall.branch_id,
      name: hall.name,
      capacity: hall.capacity,
      status: hall.status,
      created_at: hall.created_at,
      updated_at: hall.updated_at,
    };
  }

  private toPackageView(pkg: PackageRecord): BanquetPackageView {
    return {
      id: pkg.id,
      company_id: pkg.company_id,
      name: pkg.name,
      description: pkg.description,
      price_per_guest_minor: pkg.price_per_guest_minor,
      currency: pkg.currency,
      status: pkg.status,
      items: pkg.items.map((i) => ({ id: i.id, name: i.name, position: i.position })),
      created_at: pkg.created_at,
      updated_at: pkg.updated_at,
    };
  }
}
