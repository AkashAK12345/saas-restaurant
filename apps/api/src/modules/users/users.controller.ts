import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import {
  CreateUserDto,
  UpdateUserDto,
  AssignBranchRoleDto,
  ListUsersQueryDto,
} from './users.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import {
  RequireCompanyPermission,
  RequireBranchPermission,
} from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('users')
@UseGuards(JwtAuthGuard) // All routes require authentication
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── Company-scoped: requires X-Company-ID ────────────────────────────────

  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_VIEW)
  async listUsers(
    @Headers('x-company-id') companyId: string,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.usersService.listUsers(companyId, query.branch_id);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_VIEW)
  async getUser(
    @Param('id') userId: string,
    @Headers('x-company-id') companyId: string,
  ) {
    return this.usersService.getUser(userId, companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_CREATE)
  async createUser(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // User creation is a global operation — creates the User record only.
    // CompanyMembership assignment is a separate explicit operation.
    return this.usersService.createUser(dto, req.user.id, companyId);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_UPDATE)
  async updateUser(
    @Param('id') userId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.updateUser(userId, companyId, dto, req.user.id);
  }

  // ── Branch-scoped: requires X-Company-ID + X-Branch-ID ──────────────────

  @Post(':id/branch-roles')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.USERS_UPDATE)
  async assignBranchRole(
    @Param('id') targetUserId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: AssignBranchRoleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.assignBranchRole(targetUserId, companyId, dto, req.user.id);
  }

  @Delete(':id/branch-roles/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.USERS_UPDATE)
  async removeBranchRole(
    @Param('id') targetUserId: string,
    @Param('assignmentId') assignmentId: string,
    @Headers('x-company-id') companyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.usersService.removeBranchRole(targetUserId, companyId, assignmentId, req.user.id);
  }
}
