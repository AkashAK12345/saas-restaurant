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
  Req,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  UpdateCompanyStatusDto,
} from './companies.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { PlatformAdminGuard } from '../../common/authorization/platform-admin.guard.js';
import {
  RequireCompanyPermission,
  RequireCompanyStatusPermission,
} from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /**
   * GET /companies
   * Returns only companies the authenticated user has ACTIVE membership in.
   * No X-Company-ID required — this is user-scoped, not company-scoped.
   */
  @Get()
  async listMyCompanies(@Req() req: AuthenticatedRequest) {
    return this.companiesService.listMyCompanies(req.user.id);
  }

  /**
   * GET /companies/:id
   * Returns company details if the authenticated user has ACTIVE membership.
   * No X-Company-ID header needed — :id is the company to look up.
   * The service verifies membership directly.
   */
  @Get(':id')
  async getCompany(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Headers('x-company-id') headerCompanyId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (headerCompanyId && companyId !== headerCompanyId) {
      throw new ForbiddenException(
        'Company ID in URL does not match provided company context (X-Company-ID)',
      );
    }
    return this.companiesService.getCompany(companyId, req.user.id);
  }

  /**
   * POST /companies
   * Creates a new company. A platform operation: there is no company yet to
   * scope a permission against, so being signed in is NOT enough — only an
   * ACTIVE platform administrator passes PlatformAdminGuard. Company roles held
   * elsewhere and X-Company-ID are irrelevant to this decision.
   * The creator becomes the first ACTIVE member atomically.
   */
  @Post()
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  async createCompany(
    @Body() dto: CreateCompanyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.companiesService.createCompany(dto, req.user.id);
  }

  /**
   * PATCH /companies/:id
   * Updates a company. Requires companies.update permission in the company.
   * X-Company-ID must match the :id parameter to prevent cross-company mutations.
   */
  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.COMPANIES_UPDATE)
  async updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateCompanyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // Guard has verified the user has companies.update in X-Company-ID.
    // Enforce that the URL :id matches the authorized company context.
    if (id !== companyId) {
      throw new ForbiddenException(
        'Company ID in URL does not match authorized company context (X-Company-ID)',
      );
    }
    return this.companiesService.updateCompany(companyId, dto, req.user.id);
  }

  /**
   * PATCH /companies/:id/status
   *
   * Company lifecycle transitions (disable / recover). Separate from PATCH
   * /companies/:id because it carries a different permission and is the one
   * route that does not require the company to already be ACTIVE — otherwise
   * disabling a company would be an unrecoverable, self-inflicted lockout.
   *
   * The caller must still be an ACTIVE member of this exact company and hold
   * companies.disable within it. X-Company-ID must match the URL :id, and it is
   * the guard — not the header — that establishes authorization.
   *
   * Permitted transitions and the SUSPENDED policy are documented on
   * CompaniesService.updateCompanyStatus.
   */
  @Patch(':id/status')
  @UseGuards(PermissionGuard)
  @RequireCompanyStatusPermission(PERMISSION_KEYS.COMPANIES_DISABLE)
  async updateCompanyStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateCompanyStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (id !== companyId) {
      throw new ForbiddenException(
        'Company ID in URL does not match authorized company context (X-Company-ID)',
      );
    }
    return this.companiesService.updateCompanyStatus(companyId, dto.status, req.user.id);
  }
}
