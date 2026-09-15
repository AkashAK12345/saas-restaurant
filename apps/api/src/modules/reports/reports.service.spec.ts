import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService, REPORT_MAX_PAGE_SIZE } from './reports.service.js';
import { ReportRegistry } from './report-registry.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import type { PrismaService } from '../../core/database/prisma.service.js';
import type { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { ReportDefinition, ReportProvider, ReportQuery } from './report-contract.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function makeProvider(overrides: Partial<ReportDefinition> = {}) {
  const definition: ReportDefinition = {
    key: 'queue.tokens',
    name: 'Queue tokens',
    description: 'Tokens issued',
    domain: 'queue',
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    columns: [{ key: 'token_number', label: 'Token', type: 'number' }],
    options: [{ key: 'status', label: 'Status', values: ['WAITING', 'SEATED'] }],
    exportable: true,
    ...overrides,
  };
  const run = vi.fn(async (_query: ReportQuery) => ({
    rows: [{ token_number: 1 }],
    total: 1,
    metrics: [{ key: 'registered', label: 'Registered', value: 1, type: 'number' as const }],
  }));
  const provider: ReportProvider = { definition, run };
  return { provider, run, definition };
}

describe('ReportsService', () => {
  let prisma: any;
  let authorization: {
    hasBranchPermission: ReturnType<typeof vi.fn>;
    branchPermissionsFor: ReturnType<typeof vi.fn>;
  };
  let registry: ReportRegistry;
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      branch: { findFirst: vi.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
    };
    authorization = {
      hasBranchPermission: vi.fn().mockResolvedValue(true),
      branchPermissionsFor: vi.fn().mockResolvedValue(new Set<string>()),
    };
    registry = new ReportRegistry();
    service = new ReportsService(
      prisma as unknown as PrismaService,
      registry,
      authorization as unknown as AuthorizationService,
    );
  });

  describe('the second permission check', () => {
    // reports.view is already proved by the guard. If it were sufficient here,
    // it would quietly grant every domain's numbers to anyone who had it.
    it('refuses a report whose DOMAIN permission the caller lacks', async () => {
      const { provider } = makeProvider();
      registry.register(provider);
      authorization.hasBranchPermission.mockResolvedValue(false);

      await expect(
        service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('asks AuthorizationService for the report’s own permission at this branch', async () => {
      const { provider } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' });

      expect(authorization.hasBranchPermission).toHaveBeenCalledWith(
        USER,
        COMPANY,
        BRANCH,
        PERMISSION_KEYS.QUEUE_VIEW,
      );
    });

    it('never runs the provider when the domain check fails', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);
      authorization.hasBranchPermission.mockResolvedValue(false);

      await expect(
        service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' }),
      ).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    });

    it('lists only the reports the caller could actually run', async () => {
      const { provider: queue } = makeProvider();
      const { provider: banquet } = makeProvider({
        key: 'banquet.bookings',
        domain: 'banquet',
        permission: PERMISSION_KEYS.BANQUET_VIEW,
      });
      registry.register(queue);
      registry.register(banquet);
      authorization.branchPermissionsFor.mockResolvedValue(new Set([PERMISSION_KEYS.QUEUE_VIEW]));

      const listed = await service.listAvailable(COMPANY, BRANCH, USER);
      expect(listed.map((d) => d.key)).toEqual(['queue.tokens']);
      // Resolved ONCE for the whole catalogue, not once per report.
      expect(authorization.branchPermissionsFor).toHaveBeenCalledTimes(1);
      expect(authorization.branchPermissionsFor).toHaveBeenCalledWith(USER, COMPANY, BRANCH);
    });

    it('offers nothing when branch access itself fails', async () => {
      registry.register(makeProvider().provider);
      authorization.branchPermissionsFor.mockResolvedValue(null);
      expect(await service.listAvailable(COMPANY, BRANCH, USER)).toEqual([]);
    });

    it('carries the branch name and the drill-down target in the response', async () => {
      const { provider } = makeProvider({ drilldown: { id_key: 'booking_id', path: '/banquet/:id' } });
      registry.register(provider);
      prisma.branch.findFirst.mockResolvedValue({ timezone: 'Asia/Kolkata', name: 'Alpha Main' });
      const res = await service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' });
      expect(res.branch_name).toBe('Alpha Main');
      expect(res.drilldown).toEqual({ id_key: 'booking_id', path: '/banquet/:id' });
    });
  });

  describe('non-disclosure', () => {
    it('404s an unknown report key rather than confirming what exists', async () => {
      await expect(
        service.run(COMPANY, BRANCH, USER, { reportKey: 'pos.sales' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a branch outside the caller’s company', async () => {
      const { provider } = makeProvider();
      registry.register(provider);
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes the branch lookup by company, never by the header alone', async () => {
      const { provider } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' });

      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BRANCH, company_id: COMPANY } }),
      );
    });
  });

  describe('options', () => {
    it('passes through a value the report declared', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, {
        reportKey: 'queue.tokens',
        options: { status: 'SEATED' },
      });

      expect(run.mock.calls[0][0].options).toEqual({ status: 'SEATED' });
    });

    it('rejects a filter the report never declared', async () => {
      const { provider } = makeProvider();
      registry.register(provider);

      await expect(
        service.run(COMPANY, BRANCH, USER, {
          reportKey: 'queue.tokens',
          options: { group_by: 'customer' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a value outside the declared allow-list', async () => {
      const { provider } = makeProvider();
      registry.register(provider);

      await expect(
        service.run(COMPANY, BRANCH, USER, {
          reportKey: 'queue.tokens',
          options: { status: "WAITING'; DROP TABLE queue_tokens; --" },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('treats an omitted or empty option as absent', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, {
        reportKey: 'queue.tokens',
        options: { status: '' },
      });

      expect(run.mock.calls[0][0].options).toEqual({});
    });
  });

  describe('pagination', () => {
    it('applies the default page size', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens' });

      expect(run.mock.calls[0][0].page).toEqual({ limit: 50, offset: 0 });
    });

    it('caps a caller-supplied limit', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens', limit: 100_000 });

      expect(run.mock.calls[0][0].page.limit).toBe(REPORT_MAX_PAGE_SIZE);
    });

    it('clamps a negative offset to zero', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, { reportKey: 'queue.tokens', offset: -10 });

      expect(run.mock.calls[0][0].page.offset).toBe(0);
    });

    // A summary is a fixed shape; paginating it would hide part of the answer.
    it('does not paginate a summary report', async () => {
      const { provider, run } = makeProvider({ key: 'queue.summary', kind: 'summary' });
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, {
        reportKey: 'queue.summary',
        limit: 1,
        offset: 5,
      });

      expect(run.mock.calls[0][0].page).toEqual({ limit: REPORT_MAX_PAGE_SIZE, offset: 0 });
    });
  });

  describe('the response envelope', () => {
    it('reports the branch timezone and the local dates that were used', async () => {
      const { provider } = makeProvider();
      registry.register(provider);

      const response = await service.run(COMPANY, BRANCH, USER, {
        reportKey: 'queue.tokens',
        from: '2026-03-01',
        to: '2026-03-31',
      });

      expect(response.timezone).toBe('Asia/Kolkata');
      expect(response.filters).toMatchObject({
        branch_id: BRANCH,
        from: '2026-03-01',
        to: '2026-03-31',
        options: {},
      });
      expect(response.key).toBe('queue.tokens');
      expect(response.columns).toEqual(provider.definition.columns);
      expect(response.meta).toEqual({ total: 1, limit: 50, offset: 0 });
      expect(response.metrics).toHaveLength(1);
    });

    it('gives the provider the branch-local dates it was asked for', async () => {
      const { provider, run } = makeProvider();
      registry.register(provider);

      await service.run(COMPANY, BRANCH, USER, {
        reportKey: 'queue.tokens',
        from: '2026-03-01',
        to: '2026-03-01',
      });

      const { ctx, range } = run.mock.calls[0][0];
      expect(ctx).toEqual({
        companyId: COMPANY,
        branchId: BRANCH,
        actorUserId: USER,
        timezone: 'Asia/Kolkata',
      });
      // A single Kolkata day, half-open, starting 18:30 UTC the day before.
      expect(range.from.toISOString()).toBe('2026-02-28T18:30:00.000Z');
      expect(range.to.toISOString()).toBe('2026-03-01T18:30:00.000Z');
      expect(range.days).toBe(1);
    });
  });

  describe('describe()', () => {
    it('returns the definition to a caller who may run it', async () => {
      const { provider } = makeProvider();
      registry.register(provider);

      await expect(service.describe(COMPANY, BRANCH, USER, 'queue.tokens')).resolves.toEqual(
        provider.definition,
      );
    });

    it('refuses a report the caller may not run', async () => {
      const { provider } = makeProvider();
      registry.register(provider);
      authorization.hasBranchPermission.mockResolvedValue(false);

      await expect(service.describe(COMPANY, BRANCH, USER, 'queue.tokens')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
