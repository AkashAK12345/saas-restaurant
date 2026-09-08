import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  ChecklistTemplateStatus,
  MembershipStatus,
  Prisma,
  TaskStatus,
  UserStatus,
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
import type { TaskActorContext } from './tasks-context.js';
import {
  ChecklistIncompleteError,
  INITIAL_TASK_STATUS,
  InvalidTaskTransitionError,
  OPEN_TASK_STATUSES,
  assertTaskTransition,
  isEditable,
} from './task-state-machine.js';
import type {
  ChecklistItemView,
  ChecklistProgressView,
  StaffRefView,
  TaskDetailView,
  TaskSummaryView,
  TaskView,
} from './tasks-views.js';
import type {
  AssignTaskDto,
  CreateTaskDto,
  ListTasksQueryDto,
  TaskSummaryQueryDto,
  UpdateTaskDto,
} from './tasks.dto.js';

/** Realtime event types on the staff-only `tasks` channel. */
export const TASK_EVENT_TYPES = {
  CREATED: 'task.created',
  ASSIGNED: 'task.assigned',
  STARTED: 'task.started',
  COMPLETED: 'task.completed',
  CANCELLED: 'task.cancelled',
  CHECKLIST_UPDATED: 'task.checklist.updated',
  ROUTINE_MATERIALIZED: 'task.routine.materialized',
} as const;

const AUDIT_TASK = 'TASK';

export const TASK_INCLUDE = {
  assignee: { select: { id: true, first_name: true, last_name: true } },
  completer: { select: { id: true, first_name: true, last_name: true } },
  routine: { select: { id: true, name: true } },
  checklist: { orderBy: { position: 'asc' } },
} satisfies Prisma.TaskInclude;

export type TaskRecord = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/** Staff display name — never an email, which is credential-adjacent. */
export function staffName(
  user: { id: string; first_name: string | null; last_name: string | null } | null,
): StaffRefView | null {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return { id: user.id, name: name || 'Unnamed user' };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * The dashboard query. Every filter is applied in SQL — the browser never
   * receives a whole branch's task table to sift through.
   */
  async list(ctx: TaskActorContext, query: ListTasksQueryDto): Promise<Paginated<TaskView>> {
    const now = new Date();
    const where: Prisma.TaskWhereInput = { branch_id: ctx.branchId };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.routine_id) where.routine_id = query.routine_id;

    if (query.unassigned) {
      where.assignee_id = null;
    } else if (query.assignee) {
      // "me" resolves to the caller — the dashboard's most-used filter, and it
      // cannot be spoofed into meaning anyone else.
      where.assignee_id = query.assignee === 'me' ? ctx.actorUserId : query.assignee;
    }

    if (query.overdue) {
      where.status = { in: [...OPEN_TASK_STATUSES] };
      where.due_at = { lt: now };
    } else if (query.due_from || query.due_to) {
      where.due_at = {
        ...(query.due_from ? { gte: this.parseInstant(query.due_from, 'due_from') } : {}),
        ...(query.due_to ? { lte: this.parseInstant(query.due_to, 'due_to') } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: TASK_INCLUDE,
        // Open work first, then the most urgent, then the soonest due.
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { due_at: 'asc' }, { created_at: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toView(r, now)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /** Scoped by id AND branch in one query; 404 for anything out of scope. */
  async get(ctx: TaskActorContext, taskId: string): Promise<TaskDetailView> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, branch_id: ctx.branchId },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException();
    return this.toDetailView(task);
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  async create(ctx: TaskActorContext, dto: CreateTaskDto): Promise<TaskDetailView> {
    const dueAt = dto.due_at ? this.parseInstant(dto.due_at, 'due_at') : null;

    const task = await this.mutate(async (tx) => {
      const assigneeId = dto.assignee_id
        ? await this.resolveAssignee(tx, ctx, dto.assignee_id)
        : null;
      const checklist = dto.checklist_template_id
        ? await this.snapshotChecklist(tx, ctx.companyId, dto.checklist_template_id)
        : [];

      const created = await tx.task.create({
        data: {
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          title: dto.title,
          description: dto.description ?? null,
          status: INITIAL_TASK_STATUS,
          priority: dto.priority ?? 'NORMAL',
          due_at: dueAt,
          assignee_id: assigneeId,
          source: 'MANUAL',
          checklist_template_id: dto.checklist_template_id ?? null,
          checklist: { create: checklist },
        },
        include: TASK_INCLUDE,
      });

      await this.audit(tx, ctx, AuditEventType.CREATE, created.id, {
        action: 'create_task',
        title: dto.title,
        priority: created.priority,
        has_due_at: dueAt !== null,
        assigned: assigneeId !== null,
        checklist_items: checklist.length,
      });
      return created;
    });

    return this.emit(ctx, TASK_EVENT_TYPES.CREATED, task);
  }

  // ── Edits ─────────────────────────────────────────────────────────────────

  /** Details may only change while the work is still open. */
  async update(ctx: TaskActorContext, taskId: string, dto: UpdateTaskDto): Promise<TaskDetailView> {
    const task = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      if (!isEditable(current.status)) {
        throw new ConflictException(
          `A ${current.status.toLowerCase().replace('_', ' ')} task can no longer be edited`,
        );
      }

      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.priority !== undefined) data.priority = dto.priority;
      if (dto.due_at !== undefined) {
        data.due_at = dto.due_at === null ? null : this.parseInstant(dto.due_at, 'due_at');
      }

      const { count } = await tx.task.updateMany({
        where: { id: current.id, status: current.status },
        data,
      });
      if (count !== 1) throw new ConflictException('Task was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'update_task',
        changed_fields: Object.keys(dto),
      });
      return this.reload(tx, current.id);
    });
    return this.toDetailView(task);
  }

  /**
   * Assign, or clear the assignment.
   *
   * ASSIGNMENT IS NOT AUTHORIZATION. This records who is responsible for doing
   * the work; it grants the assignee nothing. Every API operation on the task
   * is still gated by RBAC, so an assignee without tasks.complete still cannot
   * complete it.
   */
  async assign(ctx: TaskActorContext, taskId: string, dto: AssignTaskDto): Promise<TaskDetailView> {
    const task = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      if (!isEditable(current.status)) {
        throw new ConflictException('A finished task cannot be reassigned');
      }

      const assigneeId =
        dto.assignee_id === undefined || dto.assignee_id === null
          ? null
          : await this.resolveAssignee(tx, ctx, dto.assignee_id);

      const { count } = await tx.task.updateMany({
        where: { id: current.id, status: current.status },
        data: { assignee_id: assigneeId },
      });
      if (count !== 1) throw new ConflictException('Task was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: assigneeId ? 'assign_task' : 'unassign_task',
        assignee_id: assigneeId,
      });
      return this.reload(tx, current.id);
    });
    return this.emitDetail(ctx, TASK_EVENT_TYPES.ASSIGNED, task);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** PENDING ─▶ IN_PROGRESS */
  async start(ctx: TaskActorContext, taskId: string): Promise<TaskDetailView> {
    const task = await this.transition(ctx, taskId, TaskStatus.IN_PROGRESS, { started_at: new Date() }, 'start_task');
    return this.emitDetail(ctx, TASK_EVENT_TYPES.STARTED, task);
  }

  /**
   * PENDING|IN_PROGRESS ─▶ COMPLETED.
   *
   * Refused while any REQUIRED checklist item is outstanding. That check runs
   * inside the transaction against the task's own snapshot, so it cannot be
   * bypassed by a client that skipped the frontend.
   */
  async complete(ctx: TaskActorContext, taskId: string): Promise<TaskDetailView> {
    const task = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      assertTaskTransition(current.status, TaskStatus.COMPLETED);

      const outstanding = current.checklist.filter((i) => i.is_required && !i.is_done).length;
      if (outstanding > 0) throw new ChecklistIncompleteError(outstanding);

      const { count } = await tx.task.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status: TaskStatus.COMPLETED,
          completed_at: new Date(),
          completed_by: ctx.actorUserId,
        },
      });
      if (count !== 1) throw new ConflictException('Task was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'complete_task',
        previous_status: current.status,
        checklist_items: current.checklist.length,
      });
      return this.reload(tx, current.id);
    });
    return this.emitDetail(ctx, TASK_EVENT_TYPES.COMPLETED, task);
  }

  /** PENDING|IN_PROGRESS ─▶ CANCELLED */
  async cancel(ctx: TaskActorContext, taskId: string): Promise<TaskDetailView> {
    const task = await this.transition(ctx, taskId, TaskStatus.CANCELLED, { cancelled_at: new Date() }, 'cancel_task');
    return this.emitDetail(ctx, TASK_EVENT_TYPES.CANCELLED, task);
  }

  private async transition(
    ctx: TaskActorContext,
    taskId: string,
    to: TaskStatus,
    stamps: Prisma.TaskUncheckedUpdateInput,
    action: string,
  ): Promise<TaskRecord> {
    return this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      assertTaskTransition(current.status, to);

      // Conditional on the status we validated: a lost race becomes a 409
      // rather than a double-apply.
      const { count } = await tx.task.updateMany({
        where: { id: current.id, status: current.status },
        data: { ...stamps, status: to },
      });
      if (count !== 1) throw new ConflictException('Task was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action,
        previous_status: current.status,
        new_status: to,
      });
      return this.reload(tx, current.id);
    });
  }

  // ── Checklist execution ───────────────────────────────────────────────────

  /**
   * Tick or untick one item of a task's OWN checklist snapshot. Conditional on
   * the item's current state, so two people tapping at once produce one change
   * and one controlled conflict rather than a lost update.
   */
  async setChecklistItem(
    ctx: TaskActorContext,
    taskId: string,
    itemId: string,
    isDone: boolean,
  ): Promise<TaskDetailView> {
    const task = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      if (!isEditable(current.status)) {
        throw new ConflictException('A finished task’s checklist cannot be changed');
      }
      const item = current.checklist.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('Checklist item not found');

      if (item.is_done !== isDone) {
        const { count } = await tx.taskChecklistItem.updateMany({
          where: { id: item.id, is_done: item.is_done },
          data: {
            is_done: isDone,
            done_at: isDone ? new Date() : null,
            done_by: isDone ? ctx.actorUserId : null,
          },
        });
        if (count !== 1) throw new ConflictException('Checklist item was modified concurrently');
      }

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'set_checklist_item',
        item_id: item.id,
        is_done: isDone,
      });
      return this.reload(tx, current.id);
    });
    return this.emitDetail(ctx, TASK_EVENT_TYPES.CHECKLIST_UPDATED, task);
  }

  // ── Completion reporting (Phase 9 scope only) ─────────────────────────────

  /**
   * Completion figures for one branch over a window. Domain-specific by
   * design: no provider registry, no cross-module aggregation, no export —
   * that is Phase 10's job, and it can consume this.
   */
  async summary(ctx: TaskActorContext, query: TaskSummaryQueryDto): Promise<TaskSummaryView> {
    const now = new Date();
    const to = query.to ? this.parseInstant(query.to, 'to') : now;
    const from = query.from
      ? this.parseInstant(query.from, 'from')
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (from > to) throw new BadRequestException('from must be before to');

    const rows = await this.prisma.task.findMany({
      where: { branch_id: ctx.branchId, created_at: { gte: from, lte: to } },
      include: {
        assignee: { select: { id: true, first_name: true, last_name: true } },
        routine: { select: { id: true, name: true } },
      },
    });

    const counts = {
      total: rows.length,
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      overdue: 0,
    };
    for (const t of rows) {
      if (t.status === TaskStatus.PENDING) counts.pending++;
      else if (t.status === TaskStatus.IN_PROGRESS) counts.in_progress++;
      else if (t.status === TaskStatus.COMPLETED) counts.completed++;
      else counts.cancelled++;
      if (this.isOverdue(t.status, t.due_at, now)) counts.overdue++;
    }

    const group = <K extends string>(
      keyOf: (t: (typeof rows)[number]) => { key: K; label: string },
    ) => {
      const acc = new Map<K, { label: string; total: number; completed: number }>();
      for (const t of rows) {
        const { key, label } = keyOf(t);
        const entry = acc.get(key) ?? { label, total: 0, completed: 0 };
        entry.total++;
        if (t.status === TaskStatus.COMPLETED) entry.completed++;
        acc.set(key, entry);
      }
      return [...acc.entries()].sort((a, b) => b[1].total - a[1].total);
    };

    return {
      branch_id: ctx.branchId,
      from,
      to,
      counts,
      completion_rate: this.rate(counts.completed, counts.total - counts.cancelled),
      by_routine: group((t) => ({
        key: (t.routine?.id ?? 'none') as string,
        label: t.routine?.name ?? 'Ad-hoc tasks',
      })).map(([key, v]) => ({
        routine_id: key === 'none' ? null : key,
        routine_name: v.label,
        total: v.total,
        completed: v.completed,
        completion_rate: this.rate(v.completed, v.total),
      })),
      by_assignee: group((t) => ({
        key: (t.assignee?.id ?? 'none') as string,
        label: staffName(t.assignee)?.name ?? 'Unassigned',
      })).map(([key, v]) => ({
        assignee_id: key === 'none' ? null : key,
        assignee_name: v.label,
        total: v.total,
        completed: v.completed,
        completion_rate: this.rate(v.completed, v.total),
      })),
    };
  }

  private rate(done: number, of: number): number {
    if (of <= 0) return 0;
    return Math.round((done / of) * 1000) / 10;
  }

  // ── Internals shared with the routines service ────────────────────────────

  /**
   * Copy a checklist template's items for a task to own.
   *
   * The snapshot is the whole point: editing the template afterwards cannot
   * make a completed task retroactively incomplete, and cannot add work to a
   * task somebody already finished.
   */
  async snapshotChecklist(
    tx: Prisma.TransactionClient,
    companyId: string,
    templateId: string,
  ): Promise<Array<{ label: string; position: number; is_required: boolean }>> {
    const template = await tx.checklistTemplate.findFirst({
      where: { id: templateId, company_id: companyId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Checklist template not found');
    if (template.status !== ChecklistTemplateStatus.ACTIVE) {
      throw new ConflictException('Checklist template is inactive');
    }
    return template.items.map((i) => ({
      label: i.label,
      position: i.position,
      is_required: i.is_required,
    }));
  }

  /**
   * A valid assignment target: an ACTIVE user, with ACTIVE membership of this
   * company, who actually holds a role at THIS branch. The last check is what
   * stops a task at branch A being handed to someone who only works at B.
   *
   * Holding a role here is about being present at the branch, not about
   * permissions — see the note on `assign`.
   */
  async resolveAssignee(
    tx: Prisma.TransactionClient,
    ctx: TaskActorContext,
    userId: string,
  ): Promise<string> {
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        status: UserStatus.ACTIVE,
        memberships: { some: { company_id: ctx.companyId, status: MembershipStatus.ACTIVE } },
        branch_roles: { some: { branch_id: ctx.branchId } },
      },
      select: { id: true },
    });
    // Deliberately a 404: whether a user exists in another company is not
    // something this endpoint discloses.
    if (!user) throw new NotFoundException('Assignee not found at this branch');
    return user.id;
  }

  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      if (e instanceof InvalidTaskTransitionError) throw new ConflictException(e.message);
      if (e instanceof ChecklistIncompleteError) throw new ConflictException(e.message);
      throw e;
    }
  }

  private async loadForMutation(
    tx: Prisma.TransactionClient,
    ctx: TaskActorContext,
    taskId: string,
  ): Promise<TaskRecord> {
    const task = await tx.task.findFirst({
      where: { id: taskId, branch_id: ctx.branchId, company_id: ctx.companyId },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException();
    return task;
  }

  private reload(tx: Prisma.TransactionClient, taskId: string): Promise<TaskRecord> {
    return tx.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  }

  private parseInstant(value: string, field: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO-8601 instant`);
    }
    return d;
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
        entityType: AUDIT_TASK,
        entityId,
        payload,
      },
      tx,
    );
  }

  /** Called ONLY with a committed record — after the transaction returns. */
  publish(ctx: { companyId: string; branchId: string }, type: string, task: TaskRecord): void {
    const scope: RealtimeScope = {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      channel: RealtimeChannel.TASKS,
    };
    this.broker.publish(scope, type, this.toView(task, new Date()));
  }

  private emit(ctx: TaskActorContext, type: string, task: TaskRecord): TaskDetailView {
    this.publish(ctx, type, task);
    return this.toDetailView(task);
  }

  private emitDetail(ctx: TaskActorContext, type: string, task: TaskRecord): TaskDetailView {
    return this.emit(ctx, type, task);
  }

  // ── Projections ───────────────────────────────────────────────────────────

  private isOverdue(status: TaskStatus, dueAt: Date | null, now: Date): boolean {
    return dueAt !== null && dueAt < now && OPEN_TASK_STATUSES.includes(status);
  }

  progressOf(items: ReadonlyArray<{ is_required: boolean; is_done: boolean }>): ChecklistProgressView {
    const requiredTotal = items.filter((i) => i.is_required).length;
    const requiredDone = items.filter((i) => i.is_required && i.is_done).length;
    return {
      total: items.length,
      done: items.filter((i) => i.is_done).length,
      required_total: requiredTotal,
      required_done: requiredDone,
      ready_to_complete: requiredDone === requiredTotal,
    };
  }

  toView(task: TaskRecord, now: Date = new Date()): TaskView {
    return {
      id: task.id,
      company_id: task.company_id,
      branch_id: task.branch_id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      due_at: task.due_at,
      overdue: this.isOverdue(task.status, task.due_at, now),
      assignee_id: task.assignee_id,
      assignee: staffName(task.assignee),
      source: task.source,
      routine_id: task.routine_id,
      routine_name: task.routine?.name ?? null,
      routine_occurrence_date: task.routine_occurrence_date
        ? task.routine_occurrence_date.toISOString().slice(0, 10)
        : null,
      started_at: task.started_at,
      completed_at: task.completed_at,
      completed_by: task.completed_by,
      completer: staffName(task.completer),
      cancelled_at: task.cancelled_at,
      checklist_progress: this.progressOf(task.checklist),
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  toDetailView(task: TaskRecord): TaskDetailView {
    return {
      ...this.toView(task),
      checklist: task.checklist.map(
        (i): ChecklistItemView => ({
          id: i.id,
          label: i.label,
          position: i.position,
          is_required: i.is_required,
          is_done: i.is_done,
          done_at: i.done_at,
          done_by: i.done_by,
        }),
      ),
    };
  }
}
