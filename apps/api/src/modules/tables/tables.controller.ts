import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { TablesService } from './tables.service.js';
import { CreateTableDto, UpdateTableDto } from './tables.dto.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireBranchPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Branch-scoped. Every route uses @RequireBranchPermission, so PermissionGuard
 * proves — server-side, against the database — that the caller has ACTIVE
 * membership in X-Company-ID, that X-Branch-ID belongs to that company and is
 * ACTIVE, and that the caller holds the permission at that branch.
 *
 * The branch a table is created under is therefore never taken from the body:
 * it is the verified context.
 */
@Controller('tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TABLES_VIEW)
  async list(
    @Headers('x-branch-id') branchId: string,
    @Query() page: PaginationQueryDto,
  ) {
    return this.tablesService.listTables(branchId, page);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TABLES_VIEW)
  async get(
    @Param('id', ParseUUIDPipe) tableId: string,
    @Headers('x-branch-id') branchId: string,
  ) {
    return this.tablesService.getTable(tableId, branchId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TABLES_CREATE)
  async create(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: CreateTableDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tablesService.createTable(branchId, companyId, dto, req.user.id);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.TABLES_UPDATE)
  async update(
    @Param('id', ParseUUIDPipe) tableId: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Body() dto: UpdateTableDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tablesService.updateTable(tableId, branchId, companyId, dto, req.user.id);
  }
}
