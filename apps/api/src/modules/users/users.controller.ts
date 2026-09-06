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
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import {
  CreateUserDto,
  UpdateUserDto,
  AssignBranchRoleDto,
  ListUsersQueryDto,
  UpdateUserStatusDto,
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
    @Param('id', ParseUUIDPipe) userId: string,
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
    @Param('id', ParseUUIDPipe) userId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.updateUser(userId, companyId, dto, req.user.id);
  }

  /**
   * PATCH /users/:id/status
   *
   * GLOBAL account enable/disable. Requires users.disable in the company.
   *
   * This is NOT the way to remove someone from a company — that is a membership
   * operation. The service refuses to act on any user who belongs to more than
   * one company, so a company-scoped permission can never silently revoke a
   * user's access to a company the caller has no authority over.
   */
  @Patch(':id/status')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.USERS_DISABLE)
  async setUserStatus(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.setUserStatus(
      targetUserId,
      companyId,
      dto.status,
      req.user.id,
    );
  }

  // ── Branch-scoped: requires X-Company-ID + X-Branch-ID ──────────────────

  // X-Branch-ID is the branch the PermissionGuard authorized this request
  // against. It is forwarded to the service so the mutation target can be
  // constrained to that same branch.

  @Post(':id/branch-roles')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.USERS_UPDATE)
  async assignBranchRole(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchContextId: string | undefined,
    @Body() dto: AssignBranchRoleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.assignBranchRole(
      targetUserId,
      companyId,
      branchContextId,
      dto,
      req.user.id,
    );
  }

  @Delete(':id/branch-roles/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.USERS_UPDATE)
  async removeBranchRole(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchContextId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.usersService.removeBranchRole(
      targetUserId,
      companyId,
      branchContextId,
      assignmentId,
      req.user.id,
    );
  }
}
