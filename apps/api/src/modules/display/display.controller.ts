import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { DisplayDeviceKind } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { DisplayDeviceGuard, type DisplayRequest } from '../../common/display-auth/display-device.guard.js';
import { RequireDisplayKind } from '../../common/display-auth/require-display-kind.decorator.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { CreateDisplayStreamTicketDto } from '../realtime/realtime.dto.js';
import { displayKindMaySubscribe } from '../../common/realtime/channels.js';

/**
 * DEVICE-side routes. Guarded by DisplayDeviceGuard only — no JWT, no RBAC.
 *
 * Read-only foundation. The two routes here exist so a paired screen can
 * confirm its own identity and show its branch, and so the guard's branch and
 * kind restrictions are exercised end-to-end. Stream endpoints arrive in T0-B.
 */
@Controller('display')
@UseGuards(DisplayDeviceGuard)
export class DisplayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Any ACTIVE device of the requested branch may ask who it is. */
  @Get('me')
  me(@Req() req: DisplayRequest) {
    const d = req.display!;
    return { id: d.id, branch_id: d.branchId, kind: d.kind };
  }

  /**
   * Branch presentation details for queue screens. A chef board has no reason
   * to read this, so it is limited to the queue kinds.
   */
  @Get('branch')
  @RequireDisplayKind(DisplayDeviceKind.QUEUE_CUSTOMER, DisplayDeviceKind.QUEUE_ADMIN)
  async branch(@Req() req: DisplayRequest) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: req.display!.branchId },
      select: { id: true, name: true, timezone: true },
    });
    return branch;
  }

  /**
   * POST /display/stream-tickets
   *
   * The device proves itself with its long-lived credential in the
   * Authorization HEADER (never a URL) and receives a 60-second, single-use
   * ticket bound to its own branch and to the requested channel — which must
   * be one its kind is permitted (a chef board cannot ask for `queue`).
   *
   * The device then opens EventSource(/realtime/stream?ticket=…). Only the
   * short-lived ticket ever appears in a URL.
   */
  @Post('stream-tickets')
  @HttpCode(HttpStatus.CREATED)
  streamTicket(@Req() req: DisplayRequest, @Body() dto: CreateDisplayStreamTicketDto) {
    const d = req.display!;
    if (!displayKindMaySubscribe(d.kind, dto.channel)) {
      throw new ForbiddenException('This display kind cannot subscribe to that channel');
    }
    return this.realtime.issueTicket(
      { kind: 'display', deviceId: d.id, displayKind: d.kind },
      d.companyId,
      d.branchId,
      dto.channel,
    );
  }
}
