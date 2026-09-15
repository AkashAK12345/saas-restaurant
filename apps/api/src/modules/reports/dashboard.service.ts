import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BranchStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { resolveReportRange } from './report-range.js';
import type { ReportContext } from './report-contract.js';
import type {
  AllBranchesDashboardResponse,
  AllBranchesWidgetResponse,
  DashboardResponse,
  DashboardWidgetProvider,
  DashboardWidgetResponse,
  WidgetMetric,
} from './dashboard-contract.js';

/**
 * The widget registry and the endpoints that fill the dashboard.
 *
 * ONE REQUEST, NOT N. The dashboard asks the server once and gets every
 * widget the caller may see, each already aggregated. The caller's
 * permissions at the branch are resolved once, and the permitted widgets run
 * concurrently — the page waits for the slowest tile, not the sum of them.
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

  private ordered(): DashboardWidgetProvider[] {
    return [...this.widgets.values()].sort((a, b) => a.definition.key.localeCompare(b.definition.key));
  }

  /** Run the permitted widgets for one branch, concurrently, each failing alone. */
  private async runFor(
    ctx: ReportContext,
    from: string | undefined,
    to: string | undefined,
    permissions: ReadonlySet<string>,
  ): Promise<{ range: ReturnType<typeof resolveReportRange>; widgets: DashboardWidgetResponse[] }> {
    const range = resolveReportRange(ctx.timezone, from, to);
    // Same rule as reports: dashboard.view gets you the dashboard, the domain
    // permission gets you that domain's tile.
    const permitted = this.ordered().filter((p) => permissions.has(p.definition.permission));
    const widgets = await Promise.all(
      permitted.map(async (provider): Promise<DashboardWidgetResponse> => {
        try {
          const result = await provider.run({ ctx, range });
          return { ...provider.definition, metrics: result.metrics };
        } catch (e) {
          this.logger.error(`Dashboard widget ${provider.definition.key} failed: ${(e as Error).message}`);
          return { ...provider.definition, metrics: [], error: 'This widget could not be loaded' };
        }
      }),
    );
    return { range, widgets };
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

    const permissions =
      (await this.authorization.branchPermissionsFor(actorUserId, companyId, branchId)) ?? new Set<string>();
    const ctx: ReportContext = { companyId, branchId, actorUserId, timezone: branch.timezone };
    const { range, widgets } = await this.runFor(ctx, from, to, permissions);

    return {
      branch_id: branchId,
      timezone: ctx.timezone,
      generated_at: new Date().toISOString(),
      filters: { from: range.fromLocal, to: range.toLocal },
      widgets,
    };
  }

  /**
   * "All Branches": every widget summed across the ACTIVE branches of the
   * company where the caller holds dashboard.view — and, per widget, only the
   * branches where they also hold its domain permission.
   *
   * There is no company-wide permission that would unlock this: each branch is
   * proved individually through the same AuthorizationService check a
   * single-branch dashboard uses, so the aggregate can never contain a branch
   * the caller could not open on its own. Holding the right at none of them
   * is a refusal, not an empty page.
   */
  async buildAllBranches(
    companyId: string,
    actorUserId: string,
    from?: string,
    to?: string,
  ): Promise<AllBranchesDashboardResponse> {
    const candidates = await this.prisma.branch.findMany({
      where: { company_id: companyId, status: BranchStatus.ACTIVE },
      select: { id: true, name: true, timezone: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const resolved = await Promise.all(
      candidates.map(async (branch) => ({
        branch,
        permissions: await this.authorization.branchPermissionsFor(actorUserId, companyId, branch.id),
      })),
    );
    const visible = resolved.filter(
      (r): r is { branch: (typeof candidates)[number]; permissions: ReadonlySet<string> } =>
        !!r.permissions && r.permissions.has(PERMISSION_KEYS.DASHBOARD_VIEW),
    );
    if (visible.length === 0) {
      throw new ForbiddenException('You do not have dashboard access at any branch of this company');
    }

    const perBranch = await Promise.all(
      visible.map(async ({ branch, permissions }) => ({
        branch,
        ...(await this.runFor(
          { companyId, branchId: branch.id, actorUserId, timezone: branch.timezone },
          from,
          to,
          permissions,
        )),
      })),
    );

    const widgets: AllBranchesWidgetResponse[] = [];
    for (const provider of this.ordered()) {
      const key = provider.definition.key;
      const contributions = perBranch
        .map((b) => ({ branch: b.branch, widget: b.widgets.find((w) => w.key === key) }))
        .filter((c): c is { branch: (typeof candidates)[number]; widget: DashboardWidgetResponse } => !!c.widget);
      if (contributions.length === 0) continue;

      const { metrics, notSummed } = sumMetrics(
        contributions.filter((c) => !c.widget.error).map((c) => c.widget.metrics),
      );
      widgets.push({
        ...provider.definition,
        metrics,
        not_summed: notSummed,
        branches: contributions.map((c) => ({
          branch_id: c.branch.id,
          branch_name: c.branch.name,
          metrics: c.widget.metrics,
          ...(c.widget.error ? { error: c.widget.error } : {}),
        })),
      });
    }

    return {
      scope: 'all_branches',
      company_id: companyId,
      generated_at: new Date().toISOString(),
      filters: { from: from ?? null, to: to ?? null },
      branches: visible.map(({ branch }) => branch),
      widgets,
    };
  }
}

/** Types whose values can be added across branches without lying. */
const SUMMABLE = new Set(['number', 'money']);

/**
 * Sum metrics key by key. Money only ever adds to money of the same currency
 * (the key already carries it, e.g. outstanding_INR). Everything else is
 * reported as not summed rather than averaged or picked from one branch.
 */
export function sumMetrics(sets: WidgetMetric[][]): { metrics: WidgetMetric[]; notSummed: string[] } {
  const totals = new Map<string, WidgetMetric>();
  const notSummed = new Map<string, string>();
  for (const set of sets) {
    for (const metric of set) {
      if (!SUMMABLE.has(metric.type) || (metric.value !== null && typeof metric.value !== 'number')) {
        notSummed.set(metric.key, metric.label);
        continue;
      }
      const existing = totals.get(metric.key);
      if (!existing) {
        totals.set(metric.key, { ...metric, value: metric.value ?? 0 });
      } else if (existing.currency !== metric.currency || existing.type !== metric.type) {
        notSummed.set(metric.key, metric.label);
      } else {
        existing.value = (existing.value as number) + ((metric.value as number | null) ?? 0);
      }
    }
  }
  for (const key of notSummed.keys()) totals.delete(key);
  return { metrics: [...totals.values()], notSummed: [...notSummed.values()] };
}
