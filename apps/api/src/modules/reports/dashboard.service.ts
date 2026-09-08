import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { resolveReportRange } from './report-range.js';
import type { ReportContext } from './report-contract.js';
import type {
  DashboardResponse,
  DashboardWidgetProvider,
  DashboardWidgetResponse,
} from './dashboard-contract.js';

/**
 * The widget registry and the single endpoint that fills the dashboard.
 *
 * ONE REQUEST, NOT N. The dashboard asks the server once and gets every
 * widget the caller may see, each already aggregated. A page that fetched a
 * widget at a time would multiply round trips by the number of tiles and
 * would still have to do the same authorization work per call.
 *
 * A widget that throws does not take the dashboard down: its tile carries an
 * error and the others render. An operator with a broken banquet tile can
 * still see the queue.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly widgets = new Map<string, DashboardWidgetProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  register(provider: DashboardWidgetProvider): void {
    const { key } = provider.definition;
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid widget key "${key}": expected "<domain>.<widget>"`);
    }
    if (this.widgets.has(key)) throw new Error(`Widget "${key}" is already registered`);
    this.widgets.set(key, provider);
    this.logger.log(`Registered dashboard widget ${key}`);
  }

  has(key: string): boolean {
    return this.widgets.has(key);
  }

  keys(): string[] {
    return [...this.widgets.keys()].sort();
  }

  async build(
    companyId: string,
    branchId: string,
    actorUserId: string,
    from?: string,
    to?: string,
  ): Promise<DashboardResponse> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, company_id: companyId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();

    const ctx: ReportContext = {
      companyId,
      branchId,
      actorUserId,
      timezone: branch.timezone,
    };
    const range = resolveReportRange(ctx.timezone, from, to);

    const widgets: DashboardWidgetResponse[] = [];
    for (const provider of [...this.widgets.values()].sort((a, b) =>
      a.definition.key.localeCompare(b.definition.key),
    )) {
      // Same rule as reports: dashboard.view gets you the dashboard, the
      // domain permission gets you that domain's tile.
      const allowed = await this.authorization.hasBranchPermission(
        actorUserId,
        companyId,
        branchId,
        provider.definition.permission,
      );
      if (!allowed) continue;

      try {
        const result = await provider.run({ ctx, range });
        widgets.push({ ...provider.definition, metrics: result.metrics });
      } catch (e) {
        this.logger.error(
          `Dashboard widget ${provider.definition.key} failed: ${(e as Error).message}`,
        );
        widgets.push({
          ...provider.definition,
          metrics: [],
          error: 'This widget could not be loaded',
        });
      }
    }

    return {
      branch_id: branchId,
      timezone: ctx.timezone,
      generated_at: new Date().toISOString(),
      filters: { from: range.fromLocal, to: range.toLocal },
      widgets,
    };
  }
}
