import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { QueueTokensService, type QueueActorContext } from './queue-tokens.service.js';
import {
  AssignQueueTableDto,
  ListQueueTokensQueryDto,
  QueueBoardQueryDto,
  RegisterQueueTokenDto,
  SeatQueueTokenDto,
} from './queue-tokens.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireBranchPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Queue tokens are branch-scoped. Every route uses @RequireBranchPermission,
 * so PermissionGuard proves — server-side, against the database — that the
 * caller has ACTIVE membership in X-Company-ID, that X-Branch-ID belongs to
 * that company and is ACTIVE, and that the caller holds the permission at
 * that branch. The headers are requested context; the guard is the proof.
 *
 * There is intentionally NO PATCH route and no writable `status` field.
 * Lifecycle changes are the explicit POST operations below, each of which
 * runs one constrained transition of the state machine.
 */
@Controller('queue-tokens')
@UseGuards(JwtAuthGuard)
export class QueueTokensController {
  constructor(private readonly queueTokens: QueueTokensService) {}

  private ctx(
    companyId: string,
    branchId: string,
    req: AuthenticatedRequest,
  ): QueueActorContext {
    return { companyId, branchId, actorUserId: req.user.id };
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_VIEW)
  list(@Headers('x-branch-id') branchId: string, @Query() query: ListQueueTokensQueryDto) {
    return this.queueTokens.list({ branchId }, query);
  }

  /**
   * The podium's working view: counts, who is waiting, who has been called,
   * and which party is next. Declared BEFORE :id so "board" is not parsed as
   * a token id.
   */
  @Get('board')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_VIEW)
  board(@Headers('x-branch-id') branchId: string, @Query() query: QueueBoardQueryDto) {
    return this.queueTokens.board(branchId, query.service_date);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string, @Headers('x-branch-id') branchId: string) {
    return this.queueTokens.get({ branchId }, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_REGISTER)
  register(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: RegisterQueueTokenDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.register(this.ctx(companyId, branchId, req), dto);
  }

  @Post(':id/call')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_CALL)
  call(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.call(this.ctx(companyId, branchId, req), id);
  }

  @Post(':id/seat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_SEAT)
  seat(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: SeatQueueTokenDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.seat(this.ctx(companyId, branchId, req), id, dto);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_NO_SHOW)
  noShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.noShow(this.ctx(companyId, branchId, req), id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_CANCEL)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.cancel(this.ctx(companyId, branchId, req), id);
  }

  // Table occupancy is part of seating, hence queue.seat for both routes.

  @Post(':id/assign-table')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_SEAT)
  assignTable(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: AssignQueueTableDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.assignTable(this.ctx(companyId, branchId, req), id, dto.table_id);
  }

  @Post(':id/release-table')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.QUEUE_SEAT)
  releaseTable(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.queueTokens.releaseTable(this.ctx(companyId, branchId, req), id);
  }
}
