import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CreateMembershipDto, UpdateMembershipDto } from './companies.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Membership controller mounted at /companies/:companyId/members.
 *
 * All routes require X-Company-ID to match the URL :companyId.
 * The guard uses X-Company-ID for authorization; the controller enforces
 * that URL companyId === X-Company-ID to prevent cross-context manipulation.
 */
@Controller('companies/:companyId/members')
@UseGuards(JwtAuthGuard)
export class MembershipsController {
  constructor(private readonly companiesService: CompaniesService) {}

  private assertContextMatch(companyId: string, headerCompanyId: string): void {
    if (companyId !== headerCompanyId) {
      throw new ForbiddenException(
        'Company ID in URL does not match authorized company context (X-Company-ID)',
      );
    }
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.MEMBERSHIPS_VIEW)
  async listMembers(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Headers('x-company-id') headerCompanyId: string,
  ) {
    this.assertContextMatch(companyId, headerCompanyId);
    return this.companiesService.listMembers(companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.MEMBERSHIPS_CREATE)
  async addMember(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Headers('x-company-id') headerCompanyId: string,
    @Body() dto: CreateMembershipDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertContextMatch(companyId, headerCompanyId);
    return this.companiesService.addMember(companyId, dto, req.user.id);
  }

  @Patch(':membershipId')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.MEMBERSHIPS_UPDATE)
  async updateMember(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Headers('x-company-id') headerCompanyId: string,
    @Body() dto: UpdateMembershipDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertContextMatch(companyId, headerCompanyId);
    return this.companiesService.updateMember(companyId, membershipId, dto, req.user.id);
  }
}
