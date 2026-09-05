import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { RolesService } from './roles.service.js';
import {
  CreateRoleDto,
  UpdateRoleDto,
  SetRolePermissionsDto,
} from './roles.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('roles')
@UseGuards(JwtAuthGuard) // All routes require authentication
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // All role management operations are company-scoped.
  // They require X-Company-ID. No branch context is needed for these operations.

  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.ROLES_VIEW)
  async listRoles(@Headers('x-company-id') companyId: string) {
    return this.rolesService.listRoles(companyId);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.ROLES_VIEW)
  async getRole(
    @Param('id') roleId: string,
    @Headers('x-company-id') companyId: string,
  ) {
    return this.rolesService.getRole(roleId, companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.ROLES_CREATE)
  async createRole(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreateRoleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rolesService.createRole(companyId, dto, req.user.id);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.ROLES_UPDATE)
  async updateRole(
    @Param('id') roleId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rolesService.updateRole(roleId, companyId, dto, req.user.id);
  }

  @Put(':id/permissions')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.ROLES_UPDATE)
  async setRolePermissions(
    @Param('id') roleId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: SetRolePermissionsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rolesService.setRolePermissions(roleId, companyId, dto, req.user.id);
  }
}
