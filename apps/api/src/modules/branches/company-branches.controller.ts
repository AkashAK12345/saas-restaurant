import {
  Controller,
  Get,
  Param,
  Headers,
  UseGuards,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BranchesService } from './branches.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

/**
 * Nested company branches controller mounted at /companies/:companyId/branches.
 *
 * All routes require X-Company-ID to match the URL :companyId.
 * The guard uses X-Company-ID for authorization; the controller enforces
 * that URL companyId === X-Company-ID to prevent cross-context manipulation.
 */
@Controller('companies/:companyId/branches')
@UseGuards(JwtAuthGuard)
export class CompanyBranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BRANCHES_VIEW)
  async listBranches(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Headers('x-company-id') headerCompanyId: string,
  ) {
    if (companyId !== headerCompanyId) {
      throw new ForbiddenException(
        'Company ID in URL does not match authorized company context (X-Company-ID)',
      );
    }
    return this.branchesService.listBranches(companyId);
  }
}
