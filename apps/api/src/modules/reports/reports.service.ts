import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { ReportRegistry } from './report-registry.service.js';
import { resolveReportRange } from './report-range.js';
import type {
  ReportContext,
  ReportDefinition,
  ReportProvider,
  ReportQuery,
  ReportResponse,
} from './report-contract.js';

/** Page size for row-level reports. Exports use their own, larger cap. */
export const REPORT_MAX_PAGE_SIZE = 200;
export const REPORT_DEFAULT_PAGE_SIZE = 50;

export interface RunReportInput {
  reportKey: string;
  from?: string;
  to?: string;
  options?: Record<string, string | undefined>;
  limit?: number;
  offset?: number;
}

/**
 * Runs a report for a caller.
 *
 * TWO KEYS, ON PURPOSE. The route already proves `reports.view` at the branch
 * through PermissionGuard. This service then additionally requires the
 * report's own DOMAIN permission — `queue.view` for a queue report,
 * `banquet.view` for a banquet one — before running it.
 *
 * Without that second check, granting someone "reports" would quietly hand
 * them every domain's numbers, including banquet money, regardless of what
 * they are allowed to see anywhere else in the product. This is not a second
 * authorization system: it is the same AuthorizationService, asked a second
 * question.
 *
 * The listing endpoint applies the same rule, so a caller is never offered a
 * report they would be refused.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ReportRegistry,
    private readonly authorization: AuthorizationService,
  ) {}

  /** The branch's timezone — the authority for every date in a report. */
  private async contextFor(
    companyId: string,
    branchId: string,
    actorUserId: string,
  ): Promise<ReportContext & { branchName: string }> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, company_id: companyId },
      select: { timezone: true, name: true },
    });
    if (!branch) throw new NotFoundException();
    return { companyId, branchId, actorUserId, timezone: branch.timezone, branchName: branch.name ?? '' };
  }

  private async mayRun(ctx: ReportContext, definition: ReportDefinition): Promise<boolean> {
    return this.authorization.hasBranchPermission(
      ctx.actorUserId,
      ctx.companyId,
      ctx.branchId,
      definition.permission,
    );
  }

  /** Only the reports this caller could actually run, never a fuller menu. */
  async listAvailable(
    companyId: string,
    branchId: string,
    actorUserId: string,
  ): Promise<ReportDefinition[]> {
    await this.contextFor(companyId, branchId, actorUserId);
    // The caller's permissions are resolved ONCE and every report is tested
    // against that set — the same answer as asking per report, without
    // repeating the membership and branch checks for each one.
    const permissions = await this.authorization.branchPermissionsFor(actorUserId, companyId, branchId);
    if (!permissions) return [];
    return this.registry.definitions().filter((d) => permissions.has(d.permission));
  }

  async describe(
    companyId: string,
    branchId: string,
    actorUserId: string,
    reportKey: string,
  ): Promise<ReportDefinition> {
    const ctx = await this.contextFor(companyId, branchId, actorUserId);
    const provider = this.providerOrThrow(reportKey);
    await this.assertMayRun(ctx, provider);
    return provider.definition;
  }

  /** Resolve, authorize, validate, run. The single path every report takes. */
  async run(
    companyId: string,
    branchId: string,
    actorUserId: string,
    input: RunReportInput,
    pageCap = REPORT_MAX_PAGE_SIZE,
  ): Promise<ReportResponse> {
    // The branch name is for the response envelope only; providers get the
    // ReportContext contract and nothing more.
    const { branchName, ...ctx } = await this.contextFor(companyId, branchId, actorUserId);
    const provider = this.providerOrThrow(input.reportKey);
    await this.assertMayRun(ctx, provider);

    const range = resolveReportRange(ctx.timezone, input.from, input.to);
    const options = this.validateOptions(provider.definition, input.options ?? {});

    // A summary report is a fixed shape; only row reports paginate.
    const page =
      provider.definition.kind === 'rows'
        ? {
            limit: Math.min(Math.max(input.limit ?? REPORT_DEFAULT_PAGE_SIZE, 1), pageCap),
            offset: Math.max(input.offset ?? 0, 0),
          }
        : { limit: pageCap, offset: 0 };

    const query: ReportQuery = { ctx, range, options, page };
    const result = await provider.run(query);

    return {
      key: provider.definition.key,
      name: provider.definition.name,
      description: provider.definition.description,
      domain: provider.definition.domain,
      kind: provider.definition.kind,
      generated_at: new Date().toISOString(),
      timezone: ctx.timezone,
      branch_name: branchName,
      filters: {
        branch_id: ctx.branchId,
        from: range.fromLocal,
        to: range.toLocal,
        options,
      },
      columns: provider.definition.columns,
      drilldown: provider.definition.drilldown ?? null,
      option_specs: provider.definition.options ?? [],
      exportable: provider.definition.exportable,
      metrics: result.metrics ?? [],
      rows: result.rows,
      meta: { total: result.total, limit: page.limit, offset: page.offset },
    };
  }

  private providerOrThrow(reportKey: string): ReportProvider {
    const provider = this.registry.get(reportKey);
    // A key that does not exist and one the caller may not see are both 404 —
    // the report catalogue is not an enumeration oracle.
    if (!provider) throw new NotFoundException('Report not found');
    return provider;
  }

  private async assertMayRun(ctx: ReportContext, provider: ReportProvider): Promise<void> {
    if (!(await this.mayRun(ctx, provider.definition))) {
      throw new ForbiddenException(
        `You do not have access to the ${provider.definition.domain} data this report is built from`,
      );
    }
  }

  /** Options are an allow-list; anything unknown or unlisted is refused. */
  private validateOptions(
    definition: ReportDefinition,
    supplied: Record<string, string | undefined>,
  ): Record<string, string> {
    const specs = definition.options ?? [];
    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(supplied)) {
      if (value === undefined || value === '') continue;
      const spec = specs.find((s) => s.key === key);
      if (!spec) {
        throw new BadRequestException(`Unknown filter "${key}" for report ${definition.key}`);
      }
      if (!spec.values.includes(value)) {
        throw new BadRequestException(
          `Invalid value for "${key}": expected one of ${spec.values.join(', ')}`,
        );
      }
      out[key] = value;
    }
    return out;
  }
}
