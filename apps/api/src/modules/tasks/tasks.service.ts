import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  ChecklistItemKind,
  ChecklistTemplateStatus,
  MembershipStatus,
  Prisma,
  TaskStatus,
  UserStatus,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import {
  EVENT_BROKER,
  type EventBroker,
  type RealtimeScope,
} from '../../common/realtime/event-broker.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { TaskActorContext } from './tasks-context.js';
import { normalizeChecklistValue } from './checklist-values.js';
import {
  ChecklistIncompleteError,
  INITIAL_TASK_STATUS,
  InvalidTaskTransitionError,
  OPEN_TASK_STATUSES,
  assertTaskTransition,
  isEditable,
} from './task-state-machine.js';
import type {
  ChecklistItemPhotoView,
  ChecklistItemView,
  ChecklistProgressView,
  StaffRefView,
  TaskCommentView,
  TaskDetailView,
  TaskSummaryView,
  TaskView,
} from './tasks-views.js';
import {
  MAX_ITEM_PHOTOS,
  MAX_PHOTO_SIZE_BYTES,
  type AddTaskCommentDto,
  type AssignTaskDto,
  type CreateTaskDto,
  type ListTasksQueryDto,
  type TaskSummaryQueryDto,
  type UpdateTaskDto,
  type UploadChecklistItemPhotoDto,
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
  UPDATED: 'task.updated',
  COMMENT_ADDED: 'task.comment.added',
} as const;

const AUDIT_TASK = 'TASK';

const STAFF_SELECT = { select: { id: true, first_name: true, last_name: true } } as const;

export const TASK_INCLUDE = {
  assignee: STAFF_SELECT,
  completer: STAFF_SELECT,
  creator: STAFF_SELECT,
  assigner: STAFF_SELECT,
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
    private readonly authorization: AuthorizationService,
  ) {}

  // ── Visibility ────────────────────────────────────────────────────────────

  /**
   * Whose tasks the caller may see at this branch.
   *
   * tasks.view is the whole branch. A caller holding only tasks.view_own —
   * the guard has already proved they hold one of the two — sees the tasks
   * assigned to them or raised by them, and nothing else: not in the list,
   * not by id, and not as the target of an action. Returns null for the
   * whole branch, otherwise the narrowing filter.
   *
   * Being assigned still grants no ACTION: what the caller may do to a task
   * they can see is decided by the operation's own permission, as before.
   */
  private async visibility(ctx: TaskActorContext): Promise<Prisma.TaskWhereInput | null> {
    const perms = await this.authorization.getEffectiveBranchPermissions(ctx.actorUserId, ctx.branchId);
    if (perms.has(PERMISSION_KEYS.TASKS_VIEW)) return null;
    return { OR: [{ assignee_id: ctx.actorUserId }, { created_by: ctx.actorUserId }] };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * The dashboard query. Every filter is applied in SQL — the browser never
   * receives a whole branch's task table to sift through.
   */
  async list(ctx: TaskActorContext, query: ListTasksQueryDto): Promise<Paginated<TaskView>> {
    const now = new Date();
    const own = await this.visibility(ctx);
    const where: Prisma.TaskWhereInput = { branch_id: ctx.branchId, ...(own ? { AND: [own] } : {}) };

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
    const own = await this.visibility(ctx);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, branch_id: ctx.branchId, ...(own ? { AND: [own] } : {}) },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException();
    return this.toDetailView(task);
  }

  /**
   * Who a task at this branch may be handed to: ACTIVE users with ACTIVE
   * membership of the company who hold a role at THIS branch — exactly the
   * set resolveAssignee accepts, so the picker can never offer a name the
   * API would refuse. Display names only; never an email.
   */
  async assignableStaff(ctx: TaskActorContext): Promise<StaffRefView[]> {
    const users = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        memberships: { some: { company_id: ctx.companyId, status: MembershipStatus.ACTIVE } },
        branch_roles: { some: { branch_id: ctx.branchId } },
      },
      select: { id: true, first_name: true, last_name: true },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      take: 500,
    });
    return users.map((u) => staffName(u)!);
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async listComments(ctx: TaskActorContext, taskId: string): Promise<TaskCommentView[]> {
    // Same visibility as the task itself: a comment is never a side door.
    await this.get(ctx, taskId);
    const rows = await this.prisma.taskComment.findMany({
      where: { task_id: taskId },
      include: { author: STAFF_SELECT },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map((c) => ({
      id: c.id,
      task_id: c.task_id,
      author: staffName(c.author)!,
      body: c.body,
      created_at: c.created_at,
    }));
  }

  /**
   * A note on a task. Allowed whatever the task's status — a remark about how
   * the work went is still worth keeping once it is done — and append-only:
   * there is no edit or delete, and the database refuses both.
   */
  async addComment(ctx: TaskActorContext, taskId: string, dto: AddTaskCommentDto): Promise<TaskCommentView> {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('A comment cannot be empty');

    const { comment, task } = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      const created = await tx.taskComment.create({
        data: { task_id: current.id, author_id: ctx.actorUserId, body },
        include: { author: STAFF_SELECT },
      });
      // The body is not copied into the audit trail: it is free text and the
      // comment row is itself immutable history.
      await this.audit(tx, ctx, AuditEventType.CREATE, current.id, {
        action: 'comment_task',
        comment_id: created.id,
        length: body.length,
      });
      return { comment: created, task: current };
    });

    this.publish(ctx, TASK_EVENT_TYPES.COMMENT_ADDED, task);
    return {
      id: comment.id,
      task_id: comment.task_id,
      author: staffName(comment.author)!,
      body: comment.body,
      created_at: comment.created_at,
    };
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
          assigned_by: assigneeId ? ctx.actorUserId : null,
          assigned_at: assigneeId ? new Date() : null,
          created_by: ctx.actorUserId,
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
      // Old and new value of every field that actually changed, for the audit
      // trail. A field sent with its current value is not a change.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const track = (field: string, from: unknown, to: unknown) => {
        if (from !== to) changes[field] = { from, to };
      };
      if (dto.title !== undefined) {
        data.title = dto.title;
        track('title', current.title, dto.title);
      }
      if (dto.description !== undefined) {
        data.description = dto.description;
        track('description', current.description, dto.description);
      }
      if (dto.priority !== undefined) {
        data.priority = dto.priority;
        track('priority', current.priority, dto.priority);
      }
      if (dto.due_at !== undefined) {
        const next = dto.due_at === null ? null : this.parseInstant(dto.due_at, 'due_at');
        data.due_at = next;
        track('due_at', current.due_at?.toISOString() ?? null, next?.toISOString() ?? null);
      }

      const { count } = await tx.task.updateMany({
        where: { id: current.id, status: current.status },
        data,
      });
      if (count !== 1) throw new ConflictException('Task was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'update_task',
        changed_fields: Object.keys(changes),
        changes,
      });
      return this.reload(tx, current.id);
    });
    return this.emit(ctx, TASK_EVENT_TYPES.UPDATED, task);
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

      const previousId = current.assignee_id;
      // Responsibility moving from one person to ANOTHER. Assigning an
      // unassigned task, clearing one, or re-sending the same person are not.
      const reassigned = previousId !== null && assigneeId !== null && previousId !== assigneeId;

      const { count } = await tx.task.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          assignee_id: assigneeId,
          assigned_by: assigneeId ? ctx.actorUserId : null,
          assigned_at: assigneeId ? new Date() : null,
          ...(reassigned ? { reassignment_count: { increment: 1 } } : {}),
        },
      });
      if (count !== 1) throw new ConflictException('Task was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: assigneeId ? (reassigned ? 'reassign_task' : 'assign_task') : 'unassign_task',
        previous_assignee_id: previousId,
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
   * Tick, untick or ANSWER one item of a task's OWN checklist snapshot.
   *
   * A CHECK item is done when ticked. Any other kind (number, text, rating,
   * date) is done when it holds a valid answer: marking it done requires the
   * value, clearing it removes the value. Changing an answer on a done item
   * replaces it.
   *
   * Conditional on the item's current state (done flag AND value), so two
   * people answering at once produce one change and one controlled conflict
   * rather than a lost update.
   */
  async setChecklistItem(
    ctx: TaskActorContext,
    taskId: string,
    itemId: string,
    isDone: boolean,
    rawValue?: string,
  ): Promise<TaskDetailView> {
    const task = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      if (!isEditable(current.status)) {
        throw new ConflictException('A finished task’s checklist cannot be changed');
      }
      const item = current.checklist.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('Checklist item not found');

      let value: string | null = null;
      if (item.kind === ChecklistItemKind.CHECK) {
        if (rawValue !== undefined) throw new BadRequestException('A tick item takes no value');
      } else if (isDone) {
        value = normalizeChecklistValue(item.kind, rawValue);
      }

      if (item.is_done !== isDone || item.value !== value) {
        const { count } = await tx.taskChecklistItem.updateMany({
          where: { id: item.id, is_done: item.is_done, value: item.value },
          data: {
            is_done: isDone,
            value,
            done_at: isDone ? (item.is_done ? item.done_at : new Date()) : null,
            done_by: isDone ? ctx.actorUserId : null,
          },
        });
        if (count !== 1) throw new ConflictException('Checklist item was modified concurrently');
      }

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'set_checklist_item',
        item_id: item.id,
        kind: item.kind,
        is_done: isDone,
        // Answers can be free text about people or incidents: record that one
        // was given (and whether it changed), never what it says.
        has_value: value !== null,
        value_changed: item.value !== value,
      });
      return this.reload(tx, current.id);
    });
    return this.emitDetail(ctx, TASK_EVENT_TYPES.CHECKLIST_UPDATED, task);
  }

  // ── Checklist item photos ─────────────────────────────────────────────────
  //
  // A PHOTO item's "answer" is its attached photos rather than a scalar value
  // (see checklist-values.ts), stored the same way as BanquetBookingPhoto —
  // bytes in Postgres, capped at the item's max_photos (MAX_ITEM_PHOTOS when
  // unset) and MAX_PHOTO_SIZE_BYTES each — since SAMCO has no object storage.
  // is_done tracks "has at least one".

  async listItemPhotos(ctx: TaskActorContext, taskId: string, itemId: string): Promise<ChecklistItemPhotoView[]> {
    await this.findItem(ctx, taskId, itemId);
    return this.prisma.taskChecklistItemPhoto.findMany({
      where: { checklist_item_id: itemId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        checklist_item_id: true,
        mime_type: true,
        file_name: true,
        position: true,
        created_at: true,
      },
    });
  }

  async getItemPhotoData(
    ctx: TaskActorContext,
    taskId: string,
    itemId: string,
    photoId: string,
  ): Promise<{ data: Buffer; mime_type: string; file_name: string | null }> {
    await this.findItem(ctx, taskId, itemId);
    const photo = await this.prisma.taskChecklistItemPhoto.findFirst({
      where: { id: photoId, checklist_item_id: itemId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    return { data: photo.data, mime_type: photo.mime_type, file_name: photo.file_name };
  }

  async uploadItemPhoto(
    ctx: TaskActorContext,
    taskId: string,
    itemId: string,
    dto: UploadChecklistItemPhotoDto,
  ): Promise<ChecklistItemPhotoView> {
    const buf = Buffer.from(dto.data, 'base64');
    if (buf.length > MAX_PHOTO_SIZE_BYTES) {
      throw new BadRequestException(`Photo exceeds the ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB limit`);
    }

    const { photo, task } = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      if (!isEditable(current.status)) {
        throw new ConflictException('A finished task’s checklist cannot be changed');
      }
      const item = current.checklist.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('Checklist item not found');
      if (item.kind !== ChecklistItemKind.PHOTO) {
        throw new BadRequestException('Only a photo item accepts photos');
      }

      const limit = item.max_photos ?? MAX_ITEM_PHOTOS;
      const count = await tx.taskChecklistItemPhoto.count({ where: { checklist_item_id: item.id } });
      if (count >= limit) {
        throw new ConflictException(`This item takes at most ${limit} photos`);
      }

      const created = await tx.taskChecklistItemPhoto.create({
        data: {
          checklist_item_id: item.id,
          data: buf,
          mime_type: dto.mime_type,
          file_name: dto.file_name ?? null,
          position: count,
        },
        select: {
          id: true,
          checklist_item_id: true,
          mime_type: true,
          file_name: true,
          position: true,
          created_at: true,
        },
      });

      if (!item.is_done) {
        await tx.taskChecklistItem.update({
          where: { id: item.id },
          data: { is_done: true, done_at: new Date(), done_by: ctx.actorUserId },
        });
      }

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'upload_checklist_item_photo',
        item_id: item.id,
        photo_count: count + 1,
      });
      return { photo: created, task: current };
    });

    this.publish(ctx, TASK_EVENT_TYPES.CHECKLIST_UPDATED, task);
    return photo;
  }

  async deleteItemPhoto(ctx: TaskActorContext, taskId: string, itemId: string, photoId: string): Promise<void> {
    const task = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, taskId);
      if (!isEditable(current.status)) {
        throw new ConflictException('A finished task’s checklist cannot be changed');
      }
      const item = current.checklist.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('Checklist item not found');

      const photo = await tx.taskChecklistItemPhoto.findFirst({
        where: { id: photoId, checklist_item_id: itemId },
        select: { id: true },
      });
      if (!photo) throw new NotFoundException('Photo not found');
      await tx.taskChecklistItemPhoto.delete({ where: { id: photo.id } });

      const remaining = await tx.taskChecklistItemPhoto.count({ where: { checklist_item_id: itemId } });
      if (remaining === 0 && item.is_done) {
        await tx.taskChecklistItem.update({
          where: { id: item.id },
          data: { is_done: false, value: null, done_at: null, done_by: null },
        });
      }

      await this.audit(tx, ctx, AuditEventType.UPDATE, current.id, {
        action: 'delete_checklist_item_photo',
        item_id: item.id,
        photo_count: remaining,
      });
      return this.reload(tx, current.id);
    });
    this.publish(ctx, TASK_EVENT_TYPES.CHECKLIST_UPDATED, task);
  }

  /** Scope + existence check for a checklist item's photos, reusing `get`'s visibility rules. */
  private async findItem(ctx: TaskActorContext, taskId: string, itemId: string): Promise<ChecklistItemView> {
    const task = await this.get(ctx, taskId);
    const item = task.checklist.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Checklist item not found');
    return item;
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
  ): Promise<
    Array<{
      label: string;
      position: number;
      kind: ChecklistItemKind;
      is_required: boolean;
      section: string | null;
      max_photos: number | null;
    }>
  > {
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
      kind: i.kind,
      is_required: i.is_required,
      section: i.section,
      max_photos: i.max_photos,
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

  /**
   * Lock the task row, then read it.
   *
   * Every task mutation starts here, so the row lock serialises them all for
   * the rest of the transaction. The status-conditional updates already stop a
   * lost update on the task row itself, but they cannot stop WRITE SKEW across
   * rows: without the lock, "complete" could read a required checklist item as
   * ticked while a concurrent "untick" commits, and finish a task whose
   * required item is undone. Locking the parent row first makes the checklist
   * read and the completion one indivisible step.
   *
   * Out-of-scope ids lock nothing (no row matches) and fall through to the 404.
   */
  private async loadForMutation(
    tx: Prisma.TransactionClient,
    ctx: TaskActorContext,
    taskId: string,
  ): Promise<TaskRecord> {
    await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${taskId}::uuid AND "branch_id" = ${ctx.branchId}::uuid FOR UPDATE`;
    const own = await this.visibility(ctx);
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        branch_id: ctx.branchId,
        company_id: ctx.companyId,
        ...(own ? { AND: [own] } : {}),
      },
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
      assigned_by: task.assigned_by,
      assigner: staffName(task.assigner),
      assigned_at: task.assigned_at,
      reassignment_count: task.reassignment_count,
      created_by: task.created_by,
      creator: staffName(task.creator),
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
          kind: i.kind,
          is_required: i.is_required,
          is_done: i.is_done,
          value: i.value,
          section: i.section,
          max_photos: i.max_photos,
          done_at: i.done_at,
          done_by: i.done_by,
        }),
      ),
    };
  }
}
