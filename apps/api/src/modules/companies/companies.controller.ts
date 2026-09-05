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
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
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
   * Creates a new company.
   * Auth-only — no company context yet (platform architecture gap, documented in service).
   * The creator becomes the first ACTIVE member atomically.
   */
  @Post()
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
}
