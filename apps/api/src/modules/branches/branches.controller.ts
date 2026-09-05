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
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { BranchesService } from './branches.service.js';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

/**
 * All branch routes are company-scoped.
 * X-Company-ID is required and validated by PermissionGuard before any handler runs.
 * The service then uses company_id as a WHERE constraint in every query.
 */
interface AuthenticatedRequest {
  user: { id: string };
}
@Controller('branches')
@UseGuards(JwtAuthGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BRANCHES_VIEW)
  async listBranches(@Headers('x-company-id') companyId: string) {
    return this.branchesService.listBranches(companyId);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BRANCHES_VIEW)
  async getBranch(
    @Param('id', ParseUUIDPipe) branchId: string,
    @Headers('x-company-id') companyId: string,
  ) {
    return this.branchesService.getBranch(branchId, companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BRANCHES_CREATE)
  async createBranch(
    @Headers('x-company-id') companyId: string,
    @Body() dto: CreateBranchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.branchesService.createBranch(companyId, dto, req.user.id);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.BRANCHES_UPDATE)
  async updateBranch(
    @Param('id', ParseUUIDPipe) branchId: string,
    @Headers('x-company-id') companyId: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.branchesService.updateBranch(branchId, companyId, dto, req.user.id);
  }
}
