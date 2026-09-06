import {
  Controller,
  Post,
  Sse,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireBranchPermission } from '../../common/authorization/require-permission.decorator.js';
import { RealtimeChannel, STAFF_CHANNEL_PERMISSION } from '../../common/realtime/channels.js';
import { StreamTicketGuard, type StreamRequest } from '../../common/realtime/stream-ticket.guard.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * STAFF ticket minting + the shared SSE endpoint.
 *
 * One route per channel so each carries a static @RequireBranchPermission —
 * PermissionGuard does the whole authorization chain (active user → active
 * membership → branch in company & ACTIVE → role → permission) exactly as for
 * any other branch-scoped write. The channel is fixed by the route, never
 * chosen from the body.
 *
 * The stream itself takes ONLY a ticket. See StreamTicketGuard.
 */
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Post('tickets/queue')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequireBranchPermission(STAFF_CHANNEL_PERMISSION[RealtimeChannel.QUEUE])
  queueTicket(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.realtime.issueTicket(
      { kind: 'staff', userId: req.user.id },
      companyId,
      branchId,
      RealtimeChannel.QUEUE,
    );
  }

  @Post('tickets/banquet-kds')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequireBranchPermission(STAFF_CHANNEL_PERMISSION[RealtimeChannel.BANQUET_KDS])
  banquetKdsTicket(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.realtime.issueTicket(
      { kind: 'staff', userId: req.user.id },
      companyId,
      branchId,
      RealtimeChannel.BANQUET_KDS,
    );
  }

  @Post('tickets/tasks')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequireBranchPermission(STAFF_CHANNEL_PERMISSION[RealtimeChannel.TASKS])
  tasksTicket(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.realtime.issueTicket(
      { kind: 'staff', userId: req.user.id },
      companyId,
      branchId,
      RealtimeChannel.TASKS,
    );
  }

  /**
   * GET /realtime/stream?ticket=…   (or X-Stream-Ticket header)
   *
   * Serves staff AND display subscribers: the scope comes from the consumed
   * ticket, which was minted server-side from an authorized context. Nothing
   * about the scope is read from the client here.
   */
  @Sse('stream')
  @UseGuards(StreamTicketGuard)
  stream(
    @Req() req: StreamRequest,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    const record = req.stream!;
    return this.realtime.stream(record.scope, RealtimeService.parseLastEventId(lastEventId));
  }
}
