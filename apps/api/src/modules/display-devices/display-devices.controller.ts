import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { DisplayDevicesService } from './display-devices.service.js';
import { CreateDisplayDeviceDto } from './display-devices.dto.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireBranchPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * STAFF-side management of display devices. Ordinary JWT + branch-scoped RBAC:
 * a device is a branch asset, so pairing/revoking it requires the permission
 * at that branch, proved by PermissionGuard.
 *
 * The device-side authentication path lives in DisplayController and uses a
 * completely separate guard.
 */
@Controller('display-devices')
@UseGuards(JwtAuthGuard)
export class DisplayDevicesController {
  constructor(private readonly devices: DisplayDevicesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.DISPLAY_DEVICES_VIEW)
  async list(
    @Headers('x-branch-id') branchId: string,
    @Query() page: PaginationQueryDto,
  ) {
    return this.devices.listDevices(branchId, page);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.DISPLAY_DEVICES_VIEW)
  async get(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @Headers('x-branch-id') branchId: string,
  ) {
    return this.devices.getDevice(deviceId, branchId);
  }

  /**
   * Pair a device. The response carries the raw credential exactly once.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.DISPLAY_DEVICES_CREATE)
  async create(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateDisplayDeviceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.devices.createDevice(branchId, companyId, dto, req.user.id);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.DISPLAY_DEVICES_REVOKE)
  async revoke(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.devices.revokeDevice(deviceId, branchId, companyId, req.user.id);
  }
}
