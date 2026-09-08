import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditEventType,
  BranchStatus,
  CompanyStatus,
  Prisma,
  RoutineFrequency,
  RoutineStatus,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { TaskActorContext } from './tasks-context.js';
import type { RoutineView } from './tasks-views.js';
import type { CreateRoutineDto, UpdateRoutineDto } from './tasks.dto.js';
import {
  dueOccurrences,
  nextOccurrence,
  type RoutineSchedule,
} from './routine-schedule.js';
import { TASK_EVENT_TYPES, TasksService, TASK_INCLUDE, staffName } from './tasks.service.js';

const ROUTINE_INCLUDE = {
  checklist: { select: { id: true, name: true } },
  default_assignee: { select: { id: true, first_name: true, last_name: true } },
  branch: { select: { id: true, timezone: true, status: true } },
} satisfies Prisma.TaskRoutineInclude;

type RoutineRecord = Prisma.TaskRoutineGetPayload<{ include: typeof ROUTINE_INCLUDE }>;

const AUDIT_ROUTINE = 'TASK_ROUTINE';

/**
 * How far back a catch-up run will reach. A routine dormant for a month should
 * not dump thirty tasks on the board the first time anyone opens it.
 */
export const MATERIALIZE_LOOKBACK_DAYS = 3;

export interface MaterializeResult {
  created: number;
  skipped: number;
  routines: number;
}

/**
 * Recurring routines and the materialization of their occurrences.
 *
 * IDEMPOTENCY is a database guarantee, not an application check. Every
 * generated task carries (routine_id, routine_occurrence_date), which is
 * UNIQUE, so a duplicate attempt — a concurrent request, a second scheduler
 * replica, a retried job — fails with a unique violation that this service
 * counts as "skipped". Ten simultaneous runs produce one task.
 *
 * TIMEZONE: a routine is branch-scoped precisely so its wall-clock time has an
 * unambiguous meaning. Occurrence dates and times are read in Branch.timezone
 * via the T0-C helpers; the server's zone is never consulted.
 */
@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly tasks: TasksService,
  ) {}

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(branchId: string, page: { limit: number; offset: number }): Promise<Paginated<RoutineView>> {
    const where = { branch_id: branchId };
    const [rows, total] = await Promise.all([
      this.prisma.taskRoutine.findMany({
        where,
        include: ROUTINE_INCLUDE,
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.taskRoutine.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: { total, limit: page.limit, offset: page.offset },
    };
  }

  async get(routineId: string, branchId: string): Promise<RoutineView> {
    const routine = await this.prisma.taskRoutine.findFirst({
      where: { id: routineId, branch_id: branchId },
      include: ROUTINE_INCLUDE,
    });
    if (!routine) throw new NotFoundException();
    return this.toView(routine);
  }

  // ── Definition ────────────────────────────────────────────────────────────

  async create(ctx: TaskActorContext, dto: CreateRoutineDto): Promise<RoutineView> {
    const weekdays = this.validateSchedule(dto.frequency, dto.weekdays);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.checklist_template_id) {
          // Reuses the same scope + ACTIVE check tasks use.
          await this.tasks.snapshotChecklist(tx, ctx.companyId, dto.checklist_template_id);
        }
        const assigneeId = dto.default_assignee_id
          ? await this.tasks.resolveAssignee(tx, ctx, dto.default_assignee_id)
          : null;

        const routine = await tx.taskRoutine.create({
          data: {
            company_id: ctx.companyId,
            branch_id: ctx.branchId,
            name: dto.name,
            description: dto.description ?? null,
            frequency: dto.frequency,
            time_of_day: dto.time_of_day,
            weekdays,
            priority: dto.priority ?? 'NORMAL',
            checklist_template_id: dto.checklist_template_id ?? null,
            default_assignee_id: assigneeId,
          },
          include: ROUTINE_INCLUDE,
        });

        await this.audit(tx, ctx, AuditEventType.CREATE, routine.id, {
          action: 'create_routine',
          name: dto.name,
          frequency: dto.frequency,
          time_of_day: dto.time_of_day,
          weekdays,
        });
        return this.toView(routine);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A routine with this name already exists at this branch');
      }
      throw e;
    }
  }

  async update(ctx: TaskActorContext, routineId: string, dto: UpdateRoutineDto): Promise<RoutineView> {
    const current = await this.loadRecord(routineId, ctx);
    const frequency = dto.frequency ?? current.frequency;
    const weekdays =
      dto.frequency !== undefined || dto.weekdays !== undefined
        ? this.validateSchedule(frequency, dto.weekdays ?? current.weekdays)
        : undefined;

    const data: Prisma.TaskRoutineUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.time_of_day !== undefined) data.time_of_day = dto.time_of_day;
    if (weekdays !== undefined) data.weekdays = weekdays;
    if (dto.priority !== undefined) data.priority = dto.priority;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.checklist_template_id !== undefined) {
          if (dto.checklist_template_id === null) {
            data.checklist_template_id = null;
          } else {
            await this.tasks.snapshotChecklist(tx, ctx.companyId, dto.checklist_template_id);
            data.checklist_template_id = dto.checklist_template_id;
          }
        }
        if (dto.default_assignee_id !== undefined) {
          data.default_assignee_id =
            dto.default_assignee_id === null
              ? null
              : await this.tasks.resolveAssignee(tx, ctx, dto.default_assignee_id);
        }

        await tx.taskRoutine.update({ where: { id: routineId }, data });
        await this.audit(tx, ctx, AuditEventType.UPDATE, routineId, {
          action: 'update_routine',
          changed_fields: Object.keys(dto),
        });
        return this.toView(
          await tx.taskRoutine.findUniqueOrThrow({ where: { id: routineId }, include: ROUTINE_INCLUDE }),
        );
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException('A routine with this name already exists at this branch');
      }
      throw e;
    }
  }

  /** An INACTIVE routine materialises nothing; its existing tasks are untouched. */
  async setStatus(
    ctx: TaskActorContext,
    routineId: string,
    status: RoutineStatus,
  ): Promise<RoutineView> {
    const current = await this.loadRecord(routineId, ctx);
    if (current.status === status) {
      throw new ConflictException(`Routine is already ${status.toLowerCase()}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.taskRoutine.updateMany({
        where: { id: routineId, status: current.status },
        data: { status },
      });
      if (count !== 1) throw new ConflictException('Routine was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, routineId, {
        action: status === RoutineStatus.ACTIVE ? 'activate_routine' : 'deactivate_routine',
        previous_status: current.status,
        new_status: status,
      });
      return this.toView(
        await tx.taskRoutine.findUniqueOrThrow({ where: { id: routineId }, include: ROUTINE_INCLUDE }),
      );
    });
  }

  // ── Materialization ───────────────────────────────────────────────────────

  /**
   * Materialise every due occurrence for one branch.
   *
   * IDEMPOTENT: safe to call from the scheduler, from a request, or by hand,
   * any number of times concurrently. The unique index does the work; a
   * duplicate is counted and ignored rather than raised.
   */
  async materializeBranch(
    ctx: Pick<TaskActorContext, 'companyId' | 'branchId'> & { actorUserId?: string | null },
    now: Date = new Date(),
  ): Promise<MaterializeResult> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: ctx.branchId, company_id: ctx.companyId },
      select: { id: true, timezone: true, status: true },
    });
    if (!branch) throw new NotFoundException();
    // A closed branch generates no work.
    if (branch.status !== BranchStatus.ACTIVE) return { created: 0, skipped: 0, routines: 0 };

    const routines = await this.prisma.taskRoutine.findMany({
      where: { branch_id: ctx.branchId, status: RoutineStatus.ACTIVE },
      include: ROUTINE_INCLUDE,
    });

    let created = 0;
    let skipped = 0;
    for (const routine of routines) {
      const occurrences = dueOccurrences(
        this.scheduleOf(routine),
        branch.timezone,
        now,
        MATERIALIZE_LOOKBACK_DAYS,
      );
      for (const occurrence of occurrences) {
        const made = await this.materializeOne(ctx, routine, occurrence.date, occurrence.scheduledFor);
        if (made) created++;
        else skipped++;
      }
    }
    return { created, skipped, routines: routines.length };
  }

  /**
   * One occurrence. Returns true if THIS call created the task.
   *
   * The duplicate check is the unique constraint itself — deliberately not a
   * "does it exist?" query, which would still race. Losing the race is the
   * normal, expected outcome when several runners are active.
   */
  private async materializeOne(
    ctx: Pick<TaskActorContext, 'companyId' | 'branchId'> & { actorUserId?: string | null },
    routine: RoutineRecord,
    occurrenceDate: string,
    scheduledFor: Date,
  ): Promise<boolean> {
    try {
      const task = await this.prisma.$transaction(async (tx) => {
        const checklist = routine.checklist_template_id
          ? await this.tasks
              .snapshotChecklist(tx, ctx.companyId, routine.checklist_template_id)
              // A template retired after the routine was written must not stop
              // the routine: the task is simply generated without a checklist.
              .catch(() => [])
          : [];

        const createdTask = await tx.task.create({
          data: {
            company_id: ctx.companyId,
            branch_id: ctx.branchId,
            title: routine.name,
            description: routine.description,
            priority: routine.priority,
            due_at: scheduledFor,
            assignee_id: routine.default_assignee_id,
            source: 'ROUTINE',
            routine_id: routine.id,
            routine_occurrence_date: new Date(`${occurrenceDate}T00:00:00.000Z`),
            checklist_template_id: routine.checklist_template_id,
            checklist: { create: checklist },
          },
          include: TASK_INCLUDE,
        });

        await this.auditLogService.create(
          {
            // A scheduler run has no human actor; a request-time run does.
            actorUserId: ctx.actorUserId ?? null,
            companyId: ctx.actorUserId ? ctx.companyId : null,
            branchId: ctx.actorUserId ? ctx.branchId : null,
            eventType: AuditEventType.CREATE,
            entityType: 'TASK',
            entityId: createdTask.id,
            payload: {
              action: 'materialize_routine_task',
              routine_id: routine.id,
              occurrence_date: occurrenceDate,
              scheduled_for: scheduledFor.toISOString(),
            },
          },
          tx,
        );
        return createdTask;
      });

      this.tasks.publish(ctx, TASK_EVENT_TYPES.ROUTINE_MATERIALIZED, task);
      return true;
    } catch (e) {
      // Someone else got there first. That is success, not an error.
      if (this.isUniqueViolation(e)) return false;
      throw e;
    }
  }

  /**
   * Every ACTIVE branch of every ACTIVE company. This is what the scheduler
   * job calls; it holds no business logic of its own.
   */
  async materializeAllBranches(now: Date = new Date()): Promise<MaterializeResult> {
    const branches = await this.prisma.branch.findMany({
      where: { status: BranchStatus.ACTIVE, company: { status: CompanyStatus.ACTIVE } },
      select: { id: true, company_id: true },
    });

    const total: MaterializeResult = { created: 0, skipped: 0, routines: 0 };
    for (const branch of branches) {
      try {
        const result = await this.materializeBranch(
          { companyId: branch.company_id, branchId: branch.id, actorUserId: null },
          now,
        );
        total.created += result.created;
        total.skipped += result.skipped;
        total.routines += result.routines;
      } catch (e) {
        // One bad branch (e.g. an invalid timezone) must not stop the rest.
        this.logger.error(
          `Routine materialization failed for branch ${branch.id}: ${(e as Error).message}`,
        );
      }
    }
    return total;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** WEEKLY needs at least one weekday; DAILY must not carry any. */
  private validateSchedule(frequency: RoutineFrequency, weekdays?: number[]): number[] {
    if (frequency === RoutineFrequency.WEEKLY) {
      const days = [...new Set(weekdays ?? [])].sort((a, b) => a - b);
      if (days.length === 0) {
        throw new ConflictException('A weekly routine needs at least one weekday');
      }
      return days;
    }
    return [];
  }

  private scheduleOf(routine: { frequency: RoutineFrequency; time_of_day: string; weekdays: number[] }): RoutineSchedule {
    return {
      frequency: routine.frequency,
      timeOfDay: routine.time_of_day,
      weekdays: routine.weekdays,
    };
  }

  private async loadRecord(routineId: string, ctx: TaskActorContext): Promise<RoutineRecord> {
    const routine = await this.prisma.taskRoutine.findFirst({
      where: { id: routineId, branch_id: ctx.branchId, company_id: ctx.companyId },
      include: ROUTINE_INCLUDE,
    });
    if (!routine) throw new NotFoundException();
    return routine;
  }

  private audit(
    tx: Prisma.TransactionClient,
    ctx: TaskActorContext,
    eventType: AuditEventType,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLogService.create(
      {
        actorUserId: ctx.actorUserId,
        companyId: ctx.companyId,
        branchId: ctx.branchId,
        eventType,
        entityType: AUDIT_ROUTINE,
        entityId,
        payload,
      },
      tx,
    );
  }

  private toView(routine: RoutineRecord): RoutineView {
    const next =
      routine.status === RoutineStatus.ACTIVE && routine.branch
        ? nextOccurrence(this.scheduleOf(routine), routine.branch.timezone, new Date())
        : null;
    return {
      id: routine.id,
      company_id: routine.company_id,
      branch_id: routine.branch_id,
      name: routine.name,
      description: routine.description,
      frequency: routine.frequency,
      time_of_day: routine.time_of_day,
      weekdays: routine.weekdays,
      priority: routine.priority,
      status: routine.status,
      checklist_template_id: routine.checklist_template_id,
      checklist_name: routine.checklist?.name ?? null,
      default_assignee_id: routine.default_assignee_id,
      default_assignee: staffName(routine.default_assignee),
      next_occurrence_at: next?.scheduledFor ?? null,
      created_at: routine.created_at,
      updated_at: routine.updated_at,
    };
  }
}
