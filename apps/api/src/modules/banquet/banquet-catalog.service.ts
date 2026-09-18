import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  BanquetBookingStatus,
  BanquetHallStatus,
  Prisma,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { branchLocalToInstant } from '../../common/scheduler/branch-time.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { BanquetActorContext, BanquetCompanyContext } from './banquet-context.js';
import type {
  AvailabilityHallDayView,
  AvailabilityView,
  BanquetHallSlotView,
  BanquetHallView,
  BanquetPackageView,
  DayAvailability,
} from './banquet-views.js';
import type {
  AvailabilityQueryDto,
  CreateHallDto,
  CreateHallSlotDto,
  CreatePackageDto,
  UpdateHallDto,
  UpdateHallSlotDto,
  UpdatePackageDto,
} from './banquet.dto.js';
import { assertCurrencyCode } from './banquet-money.js';

const PACKAGE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
} satisfies Prisma.BanquetPackageInclude;

const HALL_INCLUDE = {
  slots: { orderBy: [{ position: 'asc' }, { start_time: 'asc' }] },
} satisfies Prisma.BanquetHallInclude;

type PackageRecord = Prisma.BanquetPackageGetPayload<{ include: typeof PACKAGE_INCLUDE }>;
type HallRecord = Prisma.BanquetHallGetPayload<{ include: typeof HALL_INCLUDE }>;
type SlotRecord = Prisma.BanquetHallSlotGetPayload<object>;

/** Longest range the availability calendar answers in one request (two months). */
export const MAX_AVAILABILITY_DAYS = 62;

/** Calendar arithmetic on a YYYY-MM-DD label — no wall-clock involved. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The banquet catalogue: halls and their slots (branch-scoped, like Table),
 * packages (company-scoped, like Customer — one catalogue serves every
 * branch), and the availability calendar derived from them.
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
        include: HALL_INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
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
    return this.toHallView(await this.findHall(hallId, branchId));
  }

  private async findHall(hallId: string, branchId: string): Promise<HallRecord> {
    const hall = await this.prisma.banquetHall.findFirst({
      where: { id: hallId, branch_id: branchId },
      include: HALL_INCLUDE,
    });
    if (!hall) throw new NotFoundException();
    return hall;
  }

  async createHall(ctx: BanquetActorContext, dto: CreateHallDto): Promise<BanquetHallView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const hall = await tx.banquetHall.create({
          data: { branch_id: ctx.branchId, name: dto.name, capacity: dto.capacity },
          include: HALL_INCLUDE,
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

  /**
   * Renaming a hall never rewrites a booking (each carries its own hall_name).
   * Deactivating one that still has upcoming confirmed events is refused: the
   * events would be stranded in a room nobody can book or move them into.
   */
  async updateHall(
    ctx: BanquetActorContext,
    hallId: string,
    dto: UpdateHallDto,
  ): Promise<BanquetHallView> {
    const current = await this.findHall(hallId, ctx.branchId); // scope check first — 404 hides other branches

    const data: Prisma.BanquetHallUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.status === BanquetHallStatus.INACTIVE && current.status !== BanquetHallStatus.INACTIVE) {
          const upcoming = await tx.banquetBooking.count({
            where: {
              hall_id: hallId,
              status: BanquetBookingStatus.CONFIRMED,
              ends_at: { gt: new Date() },
            },
          });
          if (upcoming > 0) {
            throw new ConflictException(
              `This hall has ${upcoming} upcoming confirmed booking(s). Move or cancel them before deactivating it.`,
            );
          }
        }

        const hall = await tx.banquetHall.update({ where: { id: hallId }, data, include: HALL_INCLUDE });
        await this.audit(tx, ctx, AuditEventType.UPDATE, 'BANQUET_HALL', hallId, {
          action: 'update_hall',
          changed_fields: Object.keys(dto),
          changes: diff(current, { name: dto.name, capacity: dto.capacity, status: dto.status }),
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

  // ── Hall slots ────────────────────────────────────────────────────────────

  async createSlot(
    ctx: BanquetActorContext,
    hallId: string,
    dto: CreateHallSlotDto,
  ): Promise<BanquetHallSlotView> {
    await this.findHall(hallId, ctx.branchId);
    assertSlotWindow(dto.start_time, dto.end_time);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const slot = await tx.banquetHallSlot.create({
          data: {
            hall_id: hallId,
            name: dto.name,
            start_time: dto.start_time,
            end_time: dto.end_time,
            position: dto.position ?? 0,
          },
        });
        await this.audit(tx, ctx, AuditEventType.CREATE, 'BANQUET_HALL_SLOT', slot.id, {
          action: 'create_hall_slot',
          hall_id: hallId,
          name: dto.name,
          start_time: dto.start_time,
          end_time: dto.end_time,
        });
        return this.toSlotView(slot);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A slot with this name already exists for this hall');
      }
      throw e;
    }
  }

  async updateSlot(
    ctx: BanquetActorContext,
    hallId: string,
    slotId: string,
    dto: UpdateHallSlotDto,
  ): Promise<BanquetHallSlotView> {
    // Scoped through the hall to the branch in ONE query.
    const current = await this.prisma.banquetHallSlot.findFirst({
      where: { id: slotId, hall_id: hallId, hall: { branch_id: ctx.branchId } },
    });
    if (!current) throw new NotFoundException();
    assertSlotWindow(dto.start_time ?? current.start_time, dto.end_time ?? current.end_time);

    const data: Prisma.BanquetHallSlotUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.start_time !== undefined) data.start_time = dto.start_time;
    if (dto.end_time !== undefined) data.end_time = dto.end_time;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const slot = await tx.banquetHallSlot.update({ where: { id: slotId }, data });
        await this.audit(tx, ctx, AuditEventType.UPDATE, 'BANQUET_HALL_SLOT', slotId, {
          action: 'update_hall_slot',
          hall_id: hallId,
          changed_fields: Object.keys(dto),
          changes: diff(current, { ...dto }),
        });
        return this.toSlotView(slot);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A slot with this name already exists for this hall');
      }
      throw e;
    }
  }

  // ── Availability ──────────────────────────────────────────────────────────

  /**
   * Hall × slot × branch-local date availability, the reference system's
   * calendar: each slot is available, tentative (only drafts overlap) or
   * booked; each hall-day is available, partial or full.
   *
   * Read-only and derived. It never RESERVES anything — two people looking at
   * the same free slot can both try to confirm, and the exclusion constraint
   * lets exactly one of them have it.
   */
  async availability(branchId: string, query: AvailabilityQueryDto): Promise<AvailabilityView> {
    if (!isCalendarDate(query.from) || !isCalendarDate(query.to)) {
      throw new BadRequestException('from and to must be real calendar dates');
    }
    if (query.to < query.from) {
      throw new BadRequestException('to must not be before from');
    }
    const dayCount =
      Math.round((Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000) + 1;
    if (dayCount > MAX_AVAILABILITY_DAYS) {
      throw new BadRequestException(`Ask for at most ${MAX_AVAILABILITY_DAYS} days at a time`);
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();
    const tz = branch.timezone;

    const halls = await this.prisma.banquetHall.findMany({
      where: query.hall_id
        ? { id: query.hall_id, branch_id: branchId }
        : { branch_id: branchId, status: BanquetHallStatus.ACTIVE },
      include: {
        slots: {
          where: { status: BanquetHallStatus.ACTIVE },
          orderBy: [{ position: 'asc' }, { start_time: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    if (query.hall_id && halls.length === 0) throw new NotFoundException();

    // One day of slack past `to` covers slots that run past midnight.
    const windowStart = branchLocalToInstant(query.from, '00:00', tz);
    const windowEnd = branchLocalToInstant(addDays(query.to, 2), '00:00', tz);
    const bookings =
      halls.length === 0
        ? []
        : await this.prisma.banquetBooking.findMany({
            where: {
              branch_id: branchId,
              hall_id: { in: halls.map((h) => h.id) },
              status: {
                in: [
                  BanquetBookingStatus.DRAFT,
                  BanquetBookingStatus.CONFIRMED,
                  BanquetBookingStatus.COMPLETED,
                ],
              },
              starts_at: { lt: windowEnd },
              ends_at: { gt: windowStart },
            },
            select: { id: true, hall_id: true, starts_at: true, ends_at: true, status: true },
            orderBy: [{ starts_at: 'asc' }, { id: 'asc' }],
          });

    const days = [];
    for (let i = 0; i < dayCount; i++) {
      const date = addDays(query.from, i);
      const dayStart = branchLocalToInstant(date, '00:00', tz);
      const dayEnd = branchLocalToInstant(addDays(date, 1), '00:00', tz);

      const hallDays: AvailabilityHallDayView[] = halls.map((hall) => {
        const ofHall = bookings.filter((b) => b.hall_id === hall.id);
        const overlapping = (start: Date, end: Date) =>
          ofHall.filter((b) => b.starts_at < end && b.ends_at > start);

        const slots = hall.slots.map((slot) => {
          const startsAt = branchLocalToInstant(date, slot.start_time, tz);
          const endsAt =
            slot.end_time > slot.start_time
              ? branchLocalToInstant(date, slot.end_time, tz)
              : branchLocalToInstant(addDays(date, 1), slot.end_time, tz);
          const hits = overlapping(startsAt, endsAt);
          const booked = hits.some((b) => b.status !== BanquetBookingStatus.DRAFT);
          return {
            slot_id: slot.id,
            name: slot.name,
            starts_at: startsAt,
            ends_at: endsAt,
            state: booked ? ('booked' as const) : hits.length > 0 ? ('tentative' as const) : ('available' as const),
            booking_ids: hits.map((b) => b.id),
          };
        });

        const onDay = overlapping(dayStart, dayEnd);
        const confirmed = onDay.filter((b) => b.status !== BanquetBookingStatus.DRAFT);
        let state: DayAvailability;
        if (slots.length > 0) {
          const bookedSlots = slots.filter((s) => s.state === 'booked').length;
          state = bookedSlots === 0 ? 'available' : bookedSlots === slots.length ? 'full' : 'partial';
        } else {
          state = confirmed.length > 0 ? 'partial' : 'available';
        }

        return {
          hall_id: hall.id,
          hall_name: hall.name,
          state,
          slots,
          confirmed_booking_ids: confirmed.map((b) => b.id),
          draft_booking_ids: onDay.filter((b) => b.status === BanquetBookingStatus.DRAFT).map((b) => b.id),
        };
      });
      days.push({ date, halls: hallDays });
    }

    return { branch_id: branchId, timezone: tz, from: query.from, to: query.to, days };
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
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
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
    return this.toPackageView(await this.findPackage(packageId, companyId));
  }

  private async findPackage(packageId: string, companyId: string): Promise<PackageRecord> {
    const pkg = await this.prisma.banquetPackage.findFirst({
      where: { id: packageId, company_id: companyId },
      include: PACKAGE_INCLUDE,
    });
    if (!pkg) throw new NotFoundException();
    return pkg;
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
   * commercial snapshot and its own copy of the component list. The price
   * change itself is audited with its old and new value.
   */
  async updatePackage(
    ctx: BanquetCompanyContext,
    packageId: string,
    dto: UpdatePackageDto,
  ): Promise<BanquetPackageView> {
    const current = await this.findPackage(packageId, ctx.companyId);
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
          changes: {
            ...diff(current, {
              name: dto.name,
              price_per_guest_minor: dto.price_per_guest_minor,
              currency,
              status: dto.status,
            }),
            ...(dto.items !== undefined
              ? { item_count: { from: current.items.length, to: pkg.items.length } }
              : {}),
          },
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
      slots: hall.slots.map((s) => this.toSlotView(s)),
      created_at: hall.created_at,
      updated_at: hall.updated_at,
    };
  }

  private toSlotView(slot: SlotRecord): BanquetHallSlotView {
    return {
      id: slot.id,
      hall_id: slot.hall_id,
      name: slot.name,
      start_time: slot.start_time,
      end_time: slot.end_time,
      position: slot.position,
      status: slot.status,
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

function assertSlotWindow(start: string, end: string): void {
  if (start === end) {
    throw new BadRequestException('A slot must not start and end at the same time');
  }
}

/** Old → new for every supplied value that actually differs. */
function diff(
  before: object,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const source = before as Record<string, unknown>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    if (to !== undefined && source[key] !== to) changes[key] = { from: source[key], to };
  }
  return changes;
}
