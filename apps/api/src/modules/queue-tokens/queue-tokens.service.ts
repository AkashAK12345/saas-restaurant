import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AuditEventType,
  BranchStatus,
  CustomerStatus,
  Prisma,
  QueueTokenEventType,
  QueueTokenStatus,
  TableStatus,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import {
  EVENT_BROKER,
  type EventBroker,
  type RealtimeScope,
} from '../../common/realtime/event-broker.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import type { Paginated } from '../../common/pagination.dto.js';
import {
  INITIAL_QUEUE_STATUS,
  InvalidQueueTransitionError,
  assertTransition,
} from './queue-state-machine.js';
import {
  currentServiceDate,
  isServiceDate,
  serviceDateFromDb,
  serviceDateToDb,
} from './queue-service-date.js';
import type {
  ListQueueTokensQueryDto,
  RegisterQueueTokenDto,
  SeatQueueTokenDto,
} from './queue-tokens.dto.js';
import type {
  QueueAdminBoard,
  QueueBoard,
  QueueCounts,
  QueueCustomerBoard,
  QueueDisplayEntry,
  QueueTokenPublicView,
  QueueTokenView,
} from './queue-views.js';

export type {
  QueueAdminBoard,
  QueueBoard,
  QueueCustomerBoard,
  QueueTokenPublicView,
  QueueTokenView,
} from './queue-views.js';

/**
 * Guard-verified request context. PermissionGuard (branch scope) has already
 * proved, against the database, that `actorUserId` is an ACTIVE user with
 * ACTIVE membership in `companyId`, that `branchId` belongs to that company
 * and is ACTIVE, and that the user holds the route's permission there.
 */
export interface QueueActorContext {
  companyId: string;
  branchId: string;
  actorUserId: string;
}

/**
 * Realtime event types published on the `queue` channel. Consumers (podium,
 * customer display, admin display) key on these strings; the payload is
 * always a QueueTokenView.
 */
export const QUEUE_EVENT_TYPES = {
  REGISTERED: 'queue.token.registered',
  CALLED: 'queue.token.called',
  SEATED: 'queue.token.seated',
  NO_SHOW: 'queue.token.no_show',
  CANCELLED: 'queue.token.cancelled',
  TABLE_ASSIGNED: 'queue.token.table_assigned',
  TABLE_RELEASED: 'queue.token.table_released',
} as const;

const AUDIT_ENTITY = 'QUEUE_TOKEN';

/** Bound on a single day's board query. One branch-day never approaches this. */
const BOARD_MAX_TOKENS = 500;

/** How many finished parties a public screen shows below the called ones. */
const CUSTOMER_BOARD_RECENT = 5;

const TOKEN_INCLUDE = {
  customer: { select: { id: true, name: true } },
  assigned_table: { select: { id: true, label: true } },
} satisfies Prisma.QueueTokenInclude;

type TokenRecord = Prisma.QueueTokenGetPayload<{ include: typeof TOKEN_INCLUDE }>;

const EVENT_SELECT = {
  id: true,
  event_type: true,
  previous_status: true,
  new_status: true,
  actor_user_id: true,
  metadata: true,
  created_at: true,
} satisfies Prisma.QueueTokenEventSelect;

interface EventInput {
  eventType: QueueTokenEventType;
  previousStatus: QueueTokenStatus | null;
  newStatus: QueueTokenStatus;
  /** Only table events carry metadata: { table_id }. */
  metadata?: { table_id: string };
}

@Injectable()
export class QueueTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Tokens of the authorized branch for one service date (default: today in
   * the branch's timezone), ordered by token number.
   */
  async list(
    ctx: Pick<QueueActorContext, 'branchId'>,
    query: ListQueueTokensQueryDto,
  ): Promise<Paginated<QueueTokenView>> {
    const serviceDate = await this.resolveServiceDate(ctx.branchId, query.service_date);

    const where: Prisma.QueueTokenWhereInput = {
      branch_id: ctx.branchId,
      service_date: serviceDateToDb(serviceDate),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.queueToken.findMany({
        where,
        include: TOKEN_INCLUDE,
        orderBy: { token_number: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.queueToken.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * The podium's board for one service date. One query, three groupings —
   * the podium never polls a list endpoint per status, and there is no second
   * queue model behind this: it reads the same queue_tokens rows.
   */
  async board(branchId: string, serviceDate?: string): Promise<QueueBoard> {
    const { date, rows } = await this.boardRows(branchId, serviceDate);
    const waiting = rows.filter((t) => t.status === QueueTokenStatus.WAITING);
    return {
      branch_id: branchId,
      service_date: date,
      counts: this.countByStatus(rows),
      // First-come, first-served: the lowest-numbered waiting token is next.
      next_waiting: waiting.length ? this.toView(waiting[0]) : null,
      waiting: waiting.map((t) => this.toView(t)),
      called: this.calledFirstOut(rows).map((t) => this.toView(t)),
      seated: rows.filter((t) => t.status === QueueTokenStatus.SEATED).map((t) => this.toView(t)),
    };
  }

  /** Admin display: the same picture as the podium board, minus customer names. */
  async adminBoard(branchId: string, serviceDate?: string): Promise<QueueAdminBoard> {
    const { date, rows } = await this.boardRows(branchId, serviceDate);
    return {
      branch_id: branchId,
      service_date: date,
      counts: this.countByStatus(rows),
      waiting: rows
        .filter((t) => t.status === QueueTokenStatus.WAITING)
        .map((t) => this.toPublicView(t)),
      called: this.calledFirstOut(rows).map((t) => this.toPublicView(t)),
      seated: rows
        .filter((t) => t.status === QueueTokenStatus.SEATED)
        .map((t) => this.toPublicView(t)),
    };
  }

  /**
   * Customer display: token numbers only. No customer identity of any kind —
   * this projection is what hangs on a wall in the dining room.
   */
  async customerBoard(branchId: string, serviceDate?: string): Promise<QueueCustomerBoard> {
    const { date, rows } = await this.boardRows(branchId, serviceDate);
    const entry = (t: TokenRecord): QueueDisplayEntry => ({
      token_number: t.token_number,
      table_label: t.assigned_table?.label ?? null,
      called_at: t.called_at,
    });
    return {
      branch_id: branchId,
      service_date: date,
      now_serving: this.calledFirstOut(rows).map(entry),
      recently_seated: rows
        .filter((t) => t.status === QueueTokenStatus.SEATED && t.seated_at !== null)
        .sort((a, b) => b.seated_at!.getTime() - a.seated_at!.getTime())
        .slice(0, CUSTOMER_BOARD_RECENT)
        .map(entry),
      waiting_count: rows.filter((t) => t.status === QueueTokenStatus.WAITING).length,
    };
  }

  /** Called parties, longest-waiting first — the order a screen should read them in. */
  private calledFirstOut(rows: TokenRecord[]): TokenRecord[] {
    return rows
      .filter((t) => t.status === QueueTokenStatus.CALLED)
      .sort((a, b) => (a.called_at?.getTime() ?? 0) - (b.called_at?.getTime() ?? 0));
  }

  private countByStatus(rows: TokenRecord[]): QueueCounts {
    const counts: QueueCounts = { waiting: 0, called: 0, seated: 0, no_show: 0, cancelled: 0 };
    for (const t of rows) {
      if (t.status === QueueTokenStatus.WAITING) counts.waiting++;
      else if (t.status === QueueTokenStatus.CALLED) counts.called++;
      else if (t.status === QueueTokenStatus.SEATED) counts.seated++;
      else if (t.status === QueueTokenStatus.NO_SHOW) counts.no_show++;
      else counts.cancelled++;
    }
    return counts;
  }

  /** All of one branch-day's tokens, ordered by number. Branch is always pinned. */
  private async boardRows(
    branchId: string,
    serviceDate?: string,
  ): Promise<{ date: string; rows: TokenRecord[] }> {
    const date = await this.resolveServiceDate(branchId, serviceDate);
    const rows = await this.prisma.queueToken.findMany({
      where: { branch_id: branchId, service_date: serviceDateToDb(date) },
      include: TOKEN_INCLUDE,
      orderBy: { token_number: 'asc' },
      take: BOARD_MAX_TOKENS,
    });
    return { date, rows };
  }

  /** Scoped by id AND branch in one query; 404 for anything out of scope. Includes the lifecycle history. */
  async get(ctx: Pick<QueueActorContext, 'branchId'>, tokenId: string) {
    const token = await this.prisma.queueToken.findFirst({
      where: { id: tokenId, branch_id: ctx.branchId },
      include: {
        ...TOKEN_INCLUDE,
        events: { select: EVENT_SELECT, orderBy: { created_at: 'asc' } },
      },
    });
    if (!token) throw new NotFoundException();
    const { events, ...rest } = token;
    return { ...this.toView(rest), events };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Registration
  // ───────────────────────────────────────────────────────────────────────────

  async register(ctx: QueueActorContext, dto: RegisterQueueTokenDto): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      // Re-read the branch inside the transaction: it is the source of the
      // timezone, and a branch deactivated between guard and commit must not
      // receive a token.
      const branch = await tx.branch.findUnique({
        where: { id: ctx.branchId },
        select: { company_id: true, status: true, timezone: true },
      });
      if (!branch || branch.company_id !== ctx.companyId) throw new NotFoundException();
      if (branch.status !== BranchStatus.ACTIVE) {
        throw new ConflictException('Branch is not active');
      }
      const serviceDate = currentServiceDate(branch.timezone);

      let customerId: string | null = null;
      if (dto.customer_id !== undefined) {
        // Scoped by id AND company in one query — a customer of another
        // company is indistinguishable from a nonexistent one.
        const customer = await tx.customer.findFirst({
          where: { id: dto.customer_id, company_id: ctx.companyId },
          select: { id: true, status: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        if (customer.status !== CustomerStatus.ACTIVE) {
          throw new ConflictException('Customer is inactive');
        }
        customerId = customer.id;
      }

      const tokenNumber = await this.allocateTokenNumber(tx, ctx.branchId, serviceDate);

      const created = await tx.queueToken.create({
        data: {
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          customer_id: customerId,
          service_date: serviceDateToDb(serviceDate),
          token_number: tokenNumber,
          status: INITIAL_QUEUE_STATUS,
          party_size: dto.party_size,
        },
        include: TOKEN_INCLUDE,
      });

      await this.recordEvent(tx, ctx, created.id, {
        eventType: QueueTokenEventType.REGISTERED,
        previousStatus: null,
        newStatus: INITIAL_QUEUE_STATUS,
      });
      await this.audit(tx, ctx, AuditEventType.CREATE, created.id, {
        action: 'register',
        service_date: serviceDate,
        token_number: tokenNumber,
        party_size: dto.party_size,
        has_customer: customerId !== null,
      });
      return created;
    });

    return this.emit(ctx, QUEUE_EVENT_TYPES.REGISTERED, token);
  }

  /**
   * Atomic per-branch, per-service-date allocation.
   *
   * One statement does everything: create the counter row if this is the
   * first token of the day, otherwise increment it, and return the number
   * handed out. ON CONFLICT DO UPDATE takes the row lock, so concurrent
   * registrations for the same branch/date serialise on it until this
   * transaction commits or rolls back — two transactions can never read the
   * same value. The unique index on (branch_id, service_date, token_number)
   * is the backstop should anything ever bypass this path.
   *
   * `next_number` stores the next value to hand out, so the row is created
   * with 2 when 1 is allocated.
   */
  private async allocateTokenNumber(
    tx: Prisma.TransactionClient,
    branchId: string,
    serviceDate: string,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ allocated: number }>>`
      INSERT INTO "queue_counters" ("id", "branch_id", "service_date", "next_number", "created_at", "updated_at")
      VALUES (${randomUUID()}::uuid, ${branchId}::uuid, ${serviceDate}::date, 2, now(), now())
      ON CONFLICT ("branch_id", "service_date")
      DO UPDATE SET "next_number" = "queue_counters"."next_number" + 1, "updated_at" = now()
      RETURNING "next_number" - 1 AS "allocated"`;
    const allocated = rows[0]?.allocated;
    if (typeof allocated !== 'number' || !Number.isInteger(allocated) || allocated < 1) {
      throw new InternalServerErrorException('Queue counter allocation failed');
    }
    return allocated;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Explicit lifecycle operations (the only writers of `status`)
  // ───────────────────────────────────────────────────────────────────────────

  /** WAITING ─▶ CALLED */
  async call(ctx: QueueActorContext, tokenId: string): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, tokenId);
      const updated = await this.applyStatus(tx, current, QueueTokenStatus.CALLED, {
        called_at: new Date(),
      });
      await this.recordEvent(tx, ctx, updated.id, {
        eventType: QueueTokenEventType.CALLED,
        previousStatus: current.status,
        newStatus: updated.status,
      });
      await this.audit(tx, ctx, AuditEventType.UPDATE, updated.id, {
        action: 'call',
        token_number: updated.token_number,
        previous_status: current.status,
        new_status: updated.status,
      });
      return updated;
    });
    return this.emit(ctx, QUEUE_EVENT_TYPES.CALLED, token);
  }

  /** CALLED ─▶ SEATED, optionally assigning a table in the same transaction. */
  async seat(ctx: QueueActorContext, tokenId: string, dto: SeatQueueTokenDto): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, tokenId);
      assertTransition(current.status, QueueTokenStatus.SEATED);

      const tableId =
        dto.table_id !== undefined
          ? await this.resolveAssignableTable(tx, ctx, dto.table_id)
          : null;

      const updated = await this.applyStatus(tx, current, QueueTokenStatus.SEATED, {
        seated_at: new Date(),
        assigned_table_id: tableId,
      });
      await this.recordEvent(tx, ctx, updated.id, {
        eventType: QueueTokenEventType.SEATED,
        previousStatus: current.status,
        newStatus: updated.status,
      });
      if (tableId !== null) {
        await this.recordEvent(tx, ctx, updated.id, {
          eventType: QueueTokenEventType.TABLE_ASSIGNED,
          previousStatus: updated.status,
          newStatus: updated.status,
          metadata: { table_id: tableId },
        });
      }
      await this.audit(tx, ctx, AuditEventType.UPDATE, updated.id, {
        action: 'seat',
        token_number: updated.token_number,
        previous_status: current.status,
        new_status: updated.status,
        table_id: tableId,
      });
      return updated;
    });
    return this.emit(ctx, QUEUE_EVENT_TYPES.SEATED, token);
  }

  /** CALLED ─▶ NO_SHOW */
  async noShow(ctx: QueueActorContext, tokenId: string): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, tokenId);
      const updated = await this.applyStatus(tx, current, QueueTokenStatus.NO_SHOW, {
        no_show_at: new Date(),
      });
      await this.recordEvent(tx, ctx, updated.id, {
        eventType: QueueTokenEventType.NO_SHOW,
        previousStatus: current.status,
        newStatus: updated.status,
      });
      await this.audit(tx, ctx, AuditEventType.UPDATE, updated.id, {
        action: 'no_show',
        token_number: updated.token_number,
        previous_status: current.status,
        new_status: updated.status,
      });
      return updated;
    });
    return this.emit(ctx, QUEUE_EVENT_TYPES.NO_SHOW, token);
  }

  /** WAITING | CALLED ─▶ CANCELLED */
  async cancel(ctx: QueueActorContext, tokenId: string): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, tokenId);
      const updated = await this.applyStatus(tx, current, QueueTokenStatus.CANCELLED, {
        cancelled_at: new Date(),
      });
      await this.recordEvent(tx, ctx, updated.id, {
        eventType: QueueTokenEventType.CANCELLED,
        previousStatus: current.status,
        newStatus: updated.status,
      });
      await this.audit(tx, ctx, AuditEventType.UPDATE, updated.id, {
        action: 'cancel',
        token_number: updated.token_number,
        previous_status: current.status,
        new_status: updated.status,
      });
      return updated;
    });
    return this.emit(ctx, QUEUE_EVENT_TYPES.CANCELLED, token);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Table occupancy (manual until POS exists; see schema comment)
  // ───────────────────────────────────────────────────────────────────────────

  /** Give a SEATED party without a table one. Status does not change. */
  async assignTable(ctx: QueueActorContext, tokenId: string, tableId: string): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, tokenId);
      if (current.status !== QueueTokenStatus.SEATED) {
        throw new ConflictException('Only a seated party can be assigned a table');
      }
      if (current.assigned_table_id !== null) {
        throw new ConflictException('Party already has a table; release it first');
      }
      const resolvedTableId = await this.resolveAssignableTable(tx, ctx, tableId);

      const { count } = await tx.queueToken.updateMany({
        where: { id: current.id, status: QueueTokenStatus.SEATED, assigned_table_id: null },
        data: { assigned_table_id: resolvedTableId },
      });
      if (count !== 1) throw new ConflictException('Queue token was modified concurrently');
      const updated = await this.reload(tx, current.id);

      await this.recordEvent(tx, ctx, updated.id, {
        eventType: QueueTokenEventType.TABLE_ASSIGNED,
        previousStatus: updated.status,
        newStatus: updated.status,
        metadata: { table_id: resolvedTableId },
      });
      await this.audit(tx, ctx, AuditEventType.UPDATE, updated.id, {
        action: 'assign_table',
        token_number: updated.token_number,
        table_id: resolvedTableId,
      });
      return updated;
    });
    return this.emit(ctx, QUEUE_EVENT_TYPES.TABLE_ASSIGNED, token);
  }

  /** Free the table held by a SEATED party. Status does not change; the assignment stays in history. */
  async releaseTable(ctx: QueueActorContext, tokenId: string): Promise<QueueTokenView> {
    const token = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, tokenId);
      if (current.status !== QueueTokenStatus.SEATED || current.assigned_table_id === null) {
        throw new ConflictException('Party does not hold a table');
      }
      const releasedTableId = current.assigned_table_id;

      const { count } = await tx.queueToken.updateMany({
        where: { id: current.id, status: QueueTokenStatus.SEATED, assigned_table_id: releasedTableId },
        data: { assigned_table_id: null },
      });
      if (count !== 1) throw new ConflictException('Queue token was modified concurrently');
      const updated = await this.reload(tx, current.id);

      await this.recordEvent(tx, ctx, updated.id, {
        eventType: QueueTokenEventType.TABLE_RELEASED,
        previousStatus: updated.status,
        newStatus: updated.status,
        metadata: { table_id: releasedTableId },
      });
      await this.audit(tx, ctx, AuditEventType.UPDATE, updated.id, {
        action: 'release_table',
        token_number: updated.token_number,
        table_id: releasedTableId,
      });
      return updated;
    });
    return this.emit(ctx, QUEUE_EVENT_TYPES.TABLE_RELEASED, token);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Every mutation runs here. The transaction owns the token row, its event
   * and its audit record together; domain errors raised inside are mapped to
   * controlled HTTP responses; and nothing is published until the callback
   * has returned, i.e. after commit.
   */
  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      if (e instanceof InvalidQueueTransitionError) throw new ConflictException(e.message);
      if (this.isSeatedTableCollision(e)) {
        throw new ConflictException('Table is already occupied by another seated party');
      }
      throw e;
    }
  }

  /** The partial unique index queue_tokens_one_seated_party_per_table fired. */
  private isSeatedTableCollision(e: unknown): boolean {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
    const target = (e.meta as { target?: unknown } | undefined)?.target;
    const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return text.includes('assigned_table_id') || text.includes('one_seated_party_per_table');
  }

  /**
   * The requested service date, or today's in the BRANCH timezone. An
   * explicit value is validated as a real calendar date — the DTO only
   * checks shape.
   */
  private async resolveServiceDate(branchId: string, requested?: string): Promise<string> {
    if (requested !== undefined) {
      if (!isServiceDate(requested)) {
        throw new BadRequestException('service_date must be a valid calendar date');
      }
      return requested;
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();
    return currentServiceDate(branch.timezone);
  }

  /** Scoped by id, branch AND company in one query; 404 for anything out of scope. */
  private async loadForMutation(
    tx: Prisma.TransactionClient,
    ctx: QueueActorContext,
    tokenId: string,
  ): Promise<TokenRecord> {
    const token = await tx.queueToken.findFirst({
      where: { id: tokenId, branch_id: ctx.branchId, company_id: ctx.companyId },
      include: TOKEN_INCLUDE,
    });
    if (!token) throw new NotFoundException();
    return token;
  }

  /**
   * Validate the transition, then apply it with a conditional update that
   * only succeeds if the row still holds the status we validated against.
   * Two operators acting on the same token at once cannot both win: the
   * second sees zero rows updated and gets a 409 instead of double-applying.
   */
  private async applyStatus(
    tx: Prisma.TransactionClient,
    current: TokenRecord,
    to: QueueTokenStatus,
    data: Omit<Prisma.QueueTokenUncheckedUpdateManyInput, 'status'>,
  ): Promise<TokenRecord> {
    assertTransition(current.status, to);
    const { count } = await tx.queueToken.updateMany({
      where: { id: current.id, status: current.status },
      data: { ...data, status: to },
    });
    if (count !== 1) throw new ConflictException('Queue token was modified concurrently');
    return this.reload(tx, current.id);
  }

  private reload(tx: Prisma.TransactionClient, tokenId: string): Promise<TokenRecord> {
    return tx.queueToken.findUniqueOrThrow({ where: { id: tokenId }, include: TOKEN_INCLUDE });
  }

  /**
   * A table may be assigned when it belongs to the token's branch, is ACTIVE,
   * and no other SEATED party currently holds it. The occupancy pre-check
   * gives a clear message in the common case; the partial unique index is
   * what actually guarantees exclusivity under concurrency (see mutate()).
   */
  private async resolveAssignableTable(
    tx: Prisma.TransactionClient,
    ctx: QueueActorContext,
    tableId: string,
  ): Promise<string> {
    const table = await tx.table.findFirst({
      where: { id: tableId, branch_id: ctx.branchId },
      select: { id: true, status: true },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (table.status !== TableStatus.ACTIVE) throw new ConflictException('Table is not active');

    const occupant = await tx.queueToken.findFirst({
      where: { assigned_table_id: table.id, status: QueueTokenStatus.SEATED },
      select: { id: true },
    });
    if (occupant) throw new ConflictException('Table is already occupied by another seated party');
    return table.id;
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    ctx: QueueActorContext,
    tokenId: string,
    input: EventInput,
  ): Promise<void> {
    await tx.queueTokenEvent.create({
      data: {
        queue_token_id: tokenId,
        event_type: input.eventType,
        previous_status: input.previousStatus,
        new_status: input.newStatus,
        actor_user_id: ctx.actorUserId,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  /** Audit payloads carry identifiers and statuses only — never customer names or phones. */
  private audit(
    tx: Prisma.TransactionClient,
    ctx: QueueActorContext,
    eventType: AuditEventType,
    tokenId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLogService.create(
      {
        actorUserId: ctx.actorUserId,
        companyId: ctx.companyId,
        branchId: ctx.branchId,
        eventType,
        entityType: AUDIT_ENTITY,
        entityId: tokenId,
        payload,
      },
      tx,
    );
  }

  /**
   * Called ONLY with a committed record. Publishes the PUBLIC projection —
   * the `queue` channel is shared by staff clients and display devices, so
   * the payload must be safe for a dining-room screen (see queue-views.ts).
   * The caller still gets the full view for its own permission-gated response.
   */
  private emit(ctx: QueueActorContext, type: string, token: TokenRecord): QueueTokenView {
    const scope: RealtimeScope = {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      channel: RealtimeChannel.QUEUE,
    };
    this.broker.publish(scope, type, this.toPublicView(token));
    return this.toView(token);
  }

  private toView(token: TokenRecord): QueueTokenView {
    return {
      ...this.toPublicView(token),
      customer: token.customer ? { id: token.customer.id, name: token.customer.name } : null,
    };
  }

  private toPublicView(token: TokenRecord): QueueTokenPublicView {
    return {
      id: token.id,
      company_id: token.company_id,
      branch_id: token.branch_id,
      customer_id: token.customer_id,
      service_date: serviceDateFromDb(token.service_date),
      token_number: token.token_number,
      status: token.status,
      party_size: token.party_size,
      assigned_table_id: token.assigned_table_id,
      assigned_table: token.assigned_table
        ? { id: token.assigned_table.id, label: token.assigned_table.label }
        : null,
      called_at: token.called_at,
      seated_at: token.seated_at,
      cancelled_at: token.cancelled_at,
      no_show_at: token.no_show_at,
      created_at: token.created_at,
      updated_at: token.updated_at,
    };
  }
}
