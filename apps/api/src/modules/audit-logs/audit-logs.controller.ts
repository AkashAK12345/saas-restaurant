import {
  Controller,
  Get,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from './audit-logs.service.js';
import { AuditLogFilterDto } from './audit-logs.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireCompanyPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * GET /audit-logs
   * Returns audit logs for the authorized company.
   * X-Company-ID is required and validated upstream by PermissionGuard.
   * Enforces pagination and allows optional filtering.
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequireCompanyPermission(PERMISSION_KEYS.AUDIT_LOGS_VIEW)
  async listLogs(
    @Headers('x-company-id') companyId: string,
    @Query() filters: AuditLogFilterDto,
  ) {
    return this.auditLogService.listLogs(companyId, filters);
  }
}
