import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportExportService } from './report-export.service.js';
import { ReportingCoreModule } from './reporting-core.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';

/**
 * Phase 10 — the reporting and dashboard HTTP layer.
 *
 * It owns no domain knowledge and imports no domain module: everything it can
 * serve arrived through ReportingCoreModule's registry, put there by the
 * modules that own the data. Adding a report to a future module requires no
 * change here.
 *
 * PrismaService and AuditLogService come from their global modules.
 */
@Module({
  imports: [AuthModule, AuthorizationModule, ReportingCoreModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportExportService],
  exports: [ReportsService],
})
export class ReportsModule {}
