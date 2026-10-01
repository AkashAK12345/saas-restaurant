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
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { UserAccessService } from './user-access.service.js';
import { CreateUserAccessDto, SaveUserAccessDto } from './user-access.dto.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * User Management. Company-scoped: a member works at one branch or at all of
 * them, and the service proves the caller holds every key it hands out.
 */
@Controller('user-access')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UserAccessController {
  constructor(private readonly access: UserAccessService) {}

  /** The toggles, daily forms and presets the form is drawn from. */
  @Get('catalog')
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_VIEW)
  catalog(@Headers('x-company-id') companyId: string) {
    return this.access.catalogue(companyId);
  }

  @Get('users')
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_VIEW)
  list(@Headers('x-company-id') companyId: string) {
    return this.access.list(companyId);
  }

  @Get('users/:id')
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_VIEW)
  detail(@Headers('x-company-id') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.detail(companyId, id);
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_CREATE)
  create(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreateUserAccessDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.access.create(companyId, req.user.id, dto);
  }

  @Put('users/:id')
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_UPDATE)
  save(
    @Headers('x-company-id') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveUserAccessDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.access.save(companyId, req.user.id, id, dto);
  }
}
