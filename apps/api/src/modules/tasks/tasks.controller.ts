import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditEventType, RoutineStatus } from '@samco/database';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { ReportExportService } from '../reports/report-export.service.js';
import { ROUTINE_LOG_PDF_MAX_DAYS } from './routine-log-export.js';
import { TasksService } from './tasks.service.js';
import { RoutinesService } from './routines.service.js';
import { ChecklistTemplatesService } from './checklist-templates.service.js';
import {
  AddTaskCommentDto,
  AssignTaskDto,
  CreateChecklistTemplateDto,
  CreateRoutineDto,
  CreateTaskDto,
  ListTasksQueryDto,
  RoutineLogExportQueryDto,
  RoutineLogQueryDto,
  TaskSummaryQueryDto,
  ToggleChecklistItemDto,
  UpdateChecklistTemplateDto,
  UpdateRoutineDto,
  UpdateTaskDto,
} from './tasks.dto.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import {
  RequireBranchPermission,
  RequireCompanyPermission,
} from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import type { TaskActorContext, TaskCompanyContext } from './tasks-context.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/** Either task read: the whole branch, or the caller's own tasks. */
const TASK_READ = [PERMISSION_KEYS.TASKS_VIEW, PERMISSION_KEYS.TASKS_VIEW_OWN] as const;

/**
 * Tasks, checklists and routines.
 *
 * Tasks and routines are BRANCH scoped; checklist templates are COMPANY
 * scoped, like customers. Every route carries a permission decorator, so
 * PermissionGuard proves — server-side, against the database — that the caller
 * has ACTIVE membership, that the branch belongs to the company and is ACTIVE,
 * and that the caller holds the permission there.
 *
 * ASSIGNMENT IS NOT AUTHORIZATION: being the assignee of a task grants nothing.
 * Every operation below is gated by the same RBAC as it would be for anyone
 * else, and the tests assert exactly that.
 *
 * There is deliberately NO route that writes a task status: each lifecycle
 * move is its own operation running one validated transition.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly routines: RoutinesService,
    private readonly checklists: ChecklistTemplatesService,
    private readonly authorization: AuthorizationService,
    private readonly exporter: ReportExportService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private branchCtx(
    companyId: string,
    branchId: string,
    req: AuthenticatedRequest,
  ): TaskActorContext {
    return { companyId, branchId, actorUserId: req.user.id };
  }

  private companyCtx(companyId: string, req: AuthenticatedRequest): TaskCompanyContext {
    return { companyId, actorUserId: req.user.id };
  }

  // ── Checklist templates (company-scoped) ─────────────────────────────────

  @Get('checklists')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.TASKS_VIEW)
  listChecklists(@Headers('x-company-id') companyId: string, @Query() page: PaginationQueryDto) {
    return this.checklists.list(companyId, page);
  }

  /** Starter definitions for the reference routines (declared before :id). */
  @Get('checklists/library')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.TASKS_VIEW)
  checklistLibrary(@Headers('x-company-id') companyId: string) {
    return this.checklists.library(companyId);
  }

  @Post('checklists/library/:key')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.TASKS_CHECKLIST_MANAGE)
  installReferenceChecklist(
    @Param('key') key: string,
    @Headers('x-company-id') companyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!/^[a-z0-9-]{1,60}$/.test(key)) throw new NotFoundException();
    return this.checklists.installReference(this.companyCtx(companyId, req), key);
  }

  @Get('checklists/:id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.TASKS_VIEW)
  getChecklist(@Param('id', ParseUUIDPipe) id: string, @Headers('x-company-id') companyId: string) {
    return this.checklists.get(id, companyId);
  }

  @Post('checklists')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.TASKS_CHECKLIST_MANAGE)
  createChecklist(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreateChecklistTemplateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checklists.create(this.companyCtx(companyId, req), dto);
  }

  @Patch('checklists/:id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.TASKS_CHECKLIST_MANAGE)
  updateChecklist(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateChecklistTemplateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checklists.update(this.companyCtx(companyId, req), id, dto);
  }

  // ── Routines (branch-scoped; declared before /tasks/:id patterns) ────────

  @Get('routines')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_VIEW)
  listRoutines(@Headers('x-branch-id') branchId: string, @Query() page: PaginationQueryDto) {
    return this.routines.list(branchId, page);
  }

  @Get('routines/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_VIEW)
  getRoutine(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.routines.get(id, branchId);
  }

  /** Transposed compliance log: checklist items × occurrence dates. */
  @Get('routines/:id/log')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_REPORTS_VIEW)
  routineLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-branch-id') branchId: string,
    @Query() query: RoutineLogQueryDto,
  ) {
    return this.routines.log(branchId, id, query);
  }

  /**
   * The compliance log as Excel or PDF.
   *
   * Two keys, exactly like a report export: tasks.reports.view on the route
   * proves the caller may read this log, and reports.export — checked here
   * through the same AuthorizationService the guard uses — proves they may take
   * data away. The file holds what the screen shows, nothing more, and the
   * export is audited (what and by whom, never the contents). PDF is refused
   * beyond ROUTINE_LOG_PDF_MAX_DAYS columns, where it stops being readable.
   */
  @Get('routines/:id/log/export')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_REPORTS_VIEW)
  async routineLogExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Query() query: RoutineLogExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const mayExport = await this.authorization.hasBranchPermission(
      req.user.id,
      companyId,
      branchId,
      PERMISSION_KEYS.REPORTS_EXPORT,
    );
    if (!mayExport) throw new ForbiddenException();

    const days = Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000) + 1;
    if (query.format === 'pdf' && days > ROUTINE_LOG_PDF_MAX_DAYS) {
      throw new BadRequestException(
        `A PDF log may cover at most ${ROUTINE_LOG_PDF_MAX_DAYS} days; use Excel for longer periods`,
      );
    }

    const report = await this.routines.logReport(branchId, id, query);
    const rendered = await this.exporter.render(report, query.format);

    await this.auditLogService.create({
      actorUserId: req.user.id,
      companyId,
      branchId,
      eventType: AuditEventType.CREATE,
      entityType: 'REPORT_EXPORT',
      entityId: report.key,
      payload: {
        action: 'export_routine_log',
        routine_id: id,
        format: query.format,
        from: report.filters.from,
        to: report.filters.to,
        row_count: report.rows.length,
        branch_name: report.branch_name,
      },
    });

    res.setHeader('Content-Type', rendered.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${rendered.filename}"`);
    res.setHeader('Content-Length', String(rendered.body.length));
    res.end(rendered.body);
  }

  @Post('routines')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ROUTINE_MANAGE)
  createRoutine(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateRoutineDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.routines.create(this.branchCtx(companyId, branchId, req), dto);
  }

  @Patch('routines/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ROUTINE_MANAGE)
  updateRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpdateRoutineDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.routines.update(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('routines/:id/activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ROUTINE_MANAGE)
  activateRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.routines.setStatus(this.branchCtx(companyId, branchId, req), id, RoutineStatus.ACTIVE);
  }

  @Post('routines/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ROUTINE_MANAGE)
  deactivateRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.routines.setStatus(this.branchCtx(companyId, branchId, req), id, RoutineStatus.INACTIVE);
  }

  /**
   * Materialise every due occurrence for this branch, now.
   *
   * The request-time path the scheduler duplicates: idempotent, so it is safe
   * to call at any time, by hand or from a screen, and safe if the scheduler
   * is disabled entirely.
   */
  @Post('routines/materialize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ROUTINE_MANAGE)
  materializeRoutines(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.routines.materializeBranch(this.branchCtx(companyId, branchId, req));
  }

  // ── Tasks (branch-scoped) ────────────────────────────────────────────────

  /** Completion reporting. Declared before :id so "summary" is not read as one. */
  @Get('tasks/summary')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_REPORTS_VIEW)
  summary(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Query() query: TaskSummaryQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.summary(this.branchCtx(companyId, branchId, req), query);
  }

  /**
   * The people a task at this branch may be handed to. Behind tasks.assign
   * (not users.view): it exists for the assignment picker and returns display
   * names only. Declared before :id.
   */
  @Get('tasks/assignable-staff')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ASSIGN)
  assignableStaff(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.assignableStaff(this.branchCtx(companyId, branchId, req));
  }

  // tasks.view shows the whole branch; tasks.view_own only the caller's own
  // tasks. The guard admits either; TasksService narrows for the second.

  @Get('tasks')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(TASK_READ)
  listTasks(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Query() query: ListTasksQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.list(this.branchCtx(companyId, branchId, req), query);
  }

  @Get('tasks/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(TASK_READ)
  getTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.get(this.branchCtx(companyId, branchId, req), id);
  }

  @Get('tasks/:id/comments')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(TASK_READ)
  listComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.listComments(this.branchCtx(companyId, branchId, req), id);
  }

  /** Commenting is working on the task, so it rides on tasks.update like ticking an item. */
  @Post('tasks/:id/comments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_UPDATE)
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: AddTaskCommentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.addComment(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_CREATE)
  createTask(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.create(this.branchCtx(companyId, branchId, req), dto);
  }

  @Patch('tasks/:id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_UPDATE)
  updateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.update(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('tasks/:id/assign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_ASSIGN)
  assignTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: AssignTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.assign(this.branchCtx(companyId, branchId, req), id, dto);
  }

  @Post('tasks/:id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_START)
  startTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.start(this.branchCtx(companyId, branchId, req), id);
  }

  @Post('tasks/:id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_COMPLETE)
  completeTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.complete(this.branchCtx(companyId, branchId, req), id);
  }

  @Post('tasks/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_CANCEL)
  cancelTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.cancel(this.branchCtx(companyId, branchId, req), id);
  }

  /** Ticking an item is doing the task, so it rides on tasks.update. */
  @Patch('tasks/:id/checklist/:itemId')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TASKS_UPDATE)
  setChecklistItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: ToggleChecklistItemDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.setChecklistItem(
      this.branchCtx(companyId, branchId, req),
      id,
      itemId,
      dto.is_done,
      dto.value,
    );
  }
}
