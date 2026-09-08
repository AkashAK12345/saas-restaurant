import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditEventType } from '@samco/database';
import { ReportsService, REPORT_MAX_PAGE_SIZE } from './reports.service.js';
import { DashboardService } from './dashboard.service.js';
import { EXPORT_MAX_ROWS, ReportExportService } from './report-export.service.js';
import {
  ReportRangeQueryDto,
  parseExportQuery,
  parseReportQuery,
} from './reports.dto.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionGuard } from '../../common/authorization/permission.guard.js';
import { RequireBranchPermission } from '../../common/authorization/require-permission.decorator.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';

interface AuthenticatedRequest {
  user: { id: string };
  /** Raw query, so report filters reach the registry rather than a fixed DTO. */
  query: unknown;
}

/**
 * Reports and the dashboard.
 *
 * Everything here is BRANCH scoped and behind PermissionGuard, so membership,
 * branch ownership, branch/company status and the route's permission are all
 * proved server-side before any query runs. The context headers are a request,
 * never the proof.
 *
 * Two keys guard a report: `reports.view` (or `reports.export`) on the route,
 * and the report's own domain permission inside ReportsService. See the note
 * there for why.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly dashboard: DashboardService,
    private readonly exporter: ReportExportService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** The catalogue, filtered to what this caller could actually run. */
  @Get('reports')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.REPORTS_VIEW)
  async list(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const definitions = await this.reports.listAvailable(companyId, branchId, req.user.id);
    return { data: definitions, meta: { total: definitions.length } };
  }

  @Get('reports/:key')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.REPORTS_VIEW)
  describe(
    @Param('key') key: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reports.describe(companyId, branchId, req.user.id, key);
  }

  @Get('reports/:key/data')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.REPORTS_VIEW)
  data(
    @Param('key') key: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // Parsed from the raw query rather than a DTO, so a report's own filters
    // reach the registry instead of a fixed list. See reports.dto.ts.
    const query = parseReportQuery(req.query);
    return this.reports.run(companyId, branchId, req.user.id, {
      reportKey: key,
      ...query,
    });
  }

  /**
   * The same report, rendered.
   *
   * Runs through the identical service path — same authorization, same
   * filters, same branch-local dates — so an export can never contain a row
   * the caller could not already read on screen. It carries `reports.export`
   * on top of that, because downloading data is a distinct act from viewing
   * it, and it is audited: what was exported, by whom, never the contents.
   */
  @Get('reports/:key/export')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.REPORTS_EXPORT)
  async export(
    @Param('key') key: string,
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { format, from, to, options } = parseExportQuery(req.query);

    const report = await this.reports.run(
      companyId,
      branchId,
      req.user.id,
      {
        reportKey: key,
        from,
        to,
        options,
        limit: EXPORT_MAX_ROWS,
        offset: 0,
      },
      EXPORT_MAX_ROWS,
    );

    const rendered = await this.exporter.render(report, format);

    await this.auditLogService.create({
      actorUserId: req.user.id,
      companyId,
      branchId,
      eventType: AuditEventType.CREATE,
      entityType: 'REPORT_EXPORT',
      entityId: report.key,
      // WHAT was exported, never the rows themselves.
      payload: {
        action: 'export_report',
        format,
        from: report.filters.from,
        to: report.filters.to,
        row_count: report.rows.length,
        options: report.filters.options,
      },
    });

    res.setHeader('Content-Type', rendered.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${rendered.filename}"`);
    res.setHeader('Content-Length', String(rendered.body.length));
    res.end(rendered.body);
  }

  /** Every widget this caller may see, aggregated server-side in one request. */
  @Get('dashboard')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.DASHBOARD_VIEW)
  getDashboard(
    @Headers('x-company-id') companyId: string,
    @Headers('x-branch-id') branchId: string,
    @Query() query: ReportRangeQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dashboard.build(companyId, branchId, req.user.id, query.from, query.to);
  }

  /** Exposed so the frontend can show the page cap without hard-coding it. */
  @Get('reports-meta/limits')
  @UseGuards(PermissionGuard)
  @RequireBranchPermission(PERMISSION_KEYS.REPORTS_VIEW)
  limits() {
    return { max_page_size: REPORT_MAX_PAGE_SIZE, max_export_rows: EXPORT_MAX_ROWS };
  }
}
