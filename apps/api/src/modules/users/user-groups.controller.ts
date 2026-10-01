import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { UserGroupsService } from './user-groups.service.js';
import { SaveUserGroupDto } from './user-groups.dto.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/** Reading groups needs users.view; changing them, users.update. */
@Controller('user-groups')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UserGroupsController {
  constructor(private readonly groups: UserGroupsService) {}

  @Get()
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_VIEW)
  list(@Headers('x-company-id') companyId: string) {
    return this.groups.list(companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_UPDATE)
  create(@Headers('x-company-id') companyId: string, @Body() dto: SaveUserGroupDto, @Req() req: AuthenticatedRequest) {
    return this.groups.create(companyId, req.user.id, dto);
  }

  @Put(':id')
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_UPDATE)
  save(
    @Headers('x-company-id') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveUserGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.save(companyId, req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_UPDATE)
  async remove(
    @Headers('x-company-id') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.groups.remove(companyId, req.user.id, id);
  }
}
