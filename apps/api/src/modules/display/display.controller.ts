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
import { QueueTokensService } from '../queue-tokens/queue-tokens.service.js';
import { BanquetKdsService } from '../banquet/banquet-kds.service.js';

/**
 * DEVICE-side routes. Guarded by DisplayDeviceGuard only — no JWT, no RBAC.
 *
 * READ ONLY, by contract. A paired screen can confirm its identity, read its
 * branch, fetch the board for its own kind and mint a short-lived stream
 * ticket. Nothing here mutates anything: every write in the queue and banquet
 * domains is a staff operation behind RBAC.
 */
@Controller('display')
@UseGuards(DisplayDeviceGuard)
export class DisplayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly queueTokens: QueueTokensService,
    private readonly banquetKds: BanquetKdsService,
  ) {}

  /** Any ACTIVE device of the requested branch may ask who it is. */
  @Get('me')
  me(@Req() req: DisplayRequest) {
    const d = req.display!;
    return { id: d.id, branch_id: d.branchId, kind: d.kind };
  }

  /**
   * Branch presentation details, so a screen can title itself. Every screen
   * kind that renders a board needs this.
   */
  @Get('branch')
  @RequireDisplayKind(
    DisplayDeviceKind.QUEUE_CUSTOMER,
    DisplayDeviceKind.QUEUE_ADMIN,
    DisplayDeviceKind.BANQUET_CHEF,
  )
  async branch(@Req() req: DisplayRequest) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: req.display!.branchId },
      select: { id: true, name: true, timezone: true },
    });
    return branch;
  }

  /**
   * The queue board for the device's OWN branch, projected for its kind.
   *
   * There is no second queue read model behind this: both projections are
   * derived from the same queue_tokens rows the podium reads. The branch is
   * taken from the authenticated device, never from a parameter, so a screen
   * cannot ask for another branch's queue.
   *
   *   QUEUE_CUSTOMER → token numbers, table labels and a waiting count only.
   *   QUEUE_ADMIN    → the full operational picture, still without customer
   *                    names (a device is not a permission-holding user).
   */
  @Get('queue/board')
  @RequireDisplayKind(DisplayDeviceKind.QUEUE_CUSTOMER, DisplayDeviceKind.QUEUE_ADMIN)
  queueBoard(@Req() req: DisplayRequest) {
    const d = req.display!;
    return d.kind === DisplayDeviceKind.QUEUE_ADMIN
      ? this.queueTokens.adminBoard(d.branchId)
      : this.queueTokens.customerBoard(d.branchId);
  }

  /**
   * The kitchen board for the device's OWN branch.
   *
   * Same discipline as the queue board: the branch comes from the
   * authenticated device row, never from a parameter, and the projection is
   * chosen server-side. A chef screen sees the room, the covers, the service
   * time, the kitchen notes and what to cook — no customer identity and no
   * money at all.
   *
   * READ ONLY. There is no device route that mutates banquet data; advancing
   * an item is a staff operation behind banquet.kds.manage.
   */
  @Get('banquet/board')
  @RequireDisplayKind(DisplayDeviceKind.BANQUET_CHEF)
  banquetBoard(@Req() req: DisplayRequest) {
    return this.banquetKds.chefBoard(req.display!.branchId);
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
