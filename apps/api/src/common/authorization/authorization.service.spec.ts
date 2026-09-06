import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Unit tests for the authorization chain:
 *   active company → active membership → branch ownership → active branch → permission
 *
 * Prisma is stubbed — these assert the decision logic itself, independently of
 * any database state, so a regression in the ordering or in a missing status
 * check fails here immediately rather than only in a full E2E run.
 */

const VALID_USER = '11111111-1111-4111-8111-111111111111';
const VALID_COMPANY = '22222222-2222-4222-8222-222222222222';
const VALID_BRANCH = '33333333-3333-4333-8333-333333333333';
const OTHER_COMPANY = '44444444-4444-4444-8444-444444444444';

function makePrisma() {
  return {
    company: { findUnique: vi.fn() },
    companyMembership: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    userBranchRole: { findMany: vi.fn() },
  };
}

/** Shapes a userBranchRole row the way the service's include clause returns it. */
function roleWithPermissions(...names: string[]) {
  return {
    role: {
      permissions: names.map((name) => ({ permission: { name } })),
    },
  };
}

describe('AuthorizationService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AuthorizationService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AuthorizationService(prisma as unknown as PrismaService);

    // Happy-path defaults; individual tests override what they are exercising.
    prisma.company.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.companyMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.branch.findUnique.mockResolvedValue({
      id: VALID_BRANCH,
      company_id: VALID_COMPANY,
      status: 'ACTIVE',
    });
    prisma.userBranchRole.findMany.mockResolvedValue([
      roleWithPermissions('users.view'),
    ]);
  });

  describe('hasActiveMembership', () => {
    it('returns true for an ACTIVE membership', async () => {
      await expect(
        service.hasActiveMembership(VALID_USER, VALID_COMPANY),
      ).resolves.toBe(true);
    });

    it('returns false for an INACTIVE membership', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue({ status: 'INACTIVE' });
      await expect(
        service.hasActiveMembership(VALID_USER, VALID_COMPANY),
      ).resolves.toBe(false);
    });

    it('returns false when no membership exists', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue(null);
      await expect(
        service.hasActiveMembership(VALID_USER, VALID_COMPANY),
      ).resolves.toBe(false);
    });

    it('rejects malformed ids without querying the database', async () => {
      await expect(service.hasActiveMembership('not-a-uuid', VALID_COMPANY)).resolves.toBe(
        false,
      );
      await expect(service.hasActiveMembership(VALID_USER, 'not-a-uuid')).resolves.toBe(
        false,
      );
      expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('isCompanyOperational', () => {
    it('is true only for ACTIVE', async () => {
      prisma.company.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      await expect(service.isCompanyOperational(VALID_COMPANY)).resolves.toBe(true);
    });

    it.each(['INACTIVE', 'SUSPENDED'])('is false for %s', async (status) => {
      prisma.company.findUnique.mockResolvedValue({ status });
      await expect(service.isCompanyOperational(VALID_COMPANY)).resolves.toBe(false);
    });

    it('is false for a missing company', async () => {
      prisma.company.findUnique.mockResolvedValue(null);
      await expect(service.isCompanyOperational(VALID_COMPANY)).resolves.toBe(false);
    });

    it('is false for a malformed id, without querying', async () => {
      await expect(service.isCompanyOperational('nope')).resolves.toBe(false);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getEffectiveCompanyPermissions', () => {
    it('unions permissions across every role held in the company', async () => {
      prisma.userBranchRole.findMany.mockResolvedValue([
        roleWithPermissions('users.view', 'roles.view'),
        roleWithPermissions('roles.view', 'pos.order.create'),
      ]);

      const perms = await service.getEffectiveCompanyPermissions(
        VALID_USER,
        VALID_COMPANY,
      );

      expect([...perms].sort()).toEqual([
        'pos.order.create',
        'roles.view',
        'users.view',
      ]);
    });

    it('scopes the query to branches within the company', async () => {
      await service.getEffectiveCompanyPermissions(VALID_USER, VALID_COMPANY);
      expect(prisma.userBranchRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: VALID_USER, branch: { company_id: VALID_COMPANY } },
        }),
      );
    });

    it('returns an empty set when the user holds no roles', async () => {
      prisma.userBranchRole.findMany.mockResolvedValue([]);
      const perms = await service.getEffectiveCompanyPermissions(
        VALID_USER,
        VALID_COMPANY,
      );
      expect(perms.size).toBe(0);
    });
  });

  describe('getEffectiveBranchPermissions', () => {
    it('unions permissions from all roles held at that branch', async () => {
      prisma.userBranchRole.findMany.mockResolvedValue([
        roleWithPermissions('pos.order.create'),
        roleWithPermissions('pos.order.cancel'),
      ]);
      const perms = await service.getEffectiveBranchPermissions(VALID_USER, VALID_BRANCH);
      expect([...perms].sort()).toEqual(['pos.order.cancel', 'pos.order.create']);
    });

    it('scopes strictly to the given branch', async () => {
      await service.getEffectiveBranchPermissions(VALID_USER, VALID_BRANCH);
      expect(prisma.userBranchRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: VALID_USER, branch_id: VALID_BRANCH },
        }),
      );
    });
  });

  describe('hasCompanyPermission', () => {
    it('allows when company is active, membership is active and permission is held', async () => {
      await expect(
        service.hasCompanyPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(true);
    });

    it('denies when the permission is not held', async () => {
      await expect(
        service.hasCompanyPermission(VALID_USER, VALID_COMPANY, 'pos.refund'),
      ).resolves.toBe(false);
    });

    it.each(['INACTIVE', 'SUSPENDED'])(
      'denies when the company is %s, before any membership lookup',
      async (status) => {
        prisma.company.findUnique.mockResolvedValue({ status });
        await expect(
          service.hasCompanyPermission(VALID_USER, VALID_COMPANY, 'users.view'),
        ).resolves.toBe(false);
        expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
      },
    );

    it('denies when membership is INACTIVE', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue({ status: 'INACTIVE' });
      await expect(
        service.hasCompanyPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(false);
    });
  });

  describe('hasBranchPermission', () => {
    it('allows on the full happy path', async () => {
      await expect(
        service.hasBranchPermission(
          VALID_USER,
          VALID_COMPANY,
          VALID_BRANCH,
          'users.view',
        ),
      ).resolves.toBe(true);
    });

    it('denies when the branch belongs to a different company', async () => {
      prisma.branch.findUnique.mockResolvedValue({
        id: VALID_BRANCH,
        company_id: OTHER_COMPANY,
        status: 'ACTIVE',
      });
      await expect(
        service.hasBranchPermission(
          VALID_USER,
          VALID_COMPANY,
          VALID_BRANCH,
          'users.view',
        ),
      ).resolves.toBe(false);
    });

    it('denies when the branch is INACTIVE', async () => {
      prisma.branch.findUnique.mockResolvedValue({
        id: VALID_BRANCH,
        company_id: VALID_COMPANY,
        status: 'INACTIVE',
      });
      await expect(
        service.hasBranchPermission(
          VALID_USER,
          VALID_COMPANY,
          VALID_BRANCH,
          'users.view',
        ),
      ).resolves.toBe(false);
    });

    it('denies when the branch does not exist', async () => {
      prisma.branch.findUnique.mockResolvedValue(null);
      await expect(
        service.hasBranchPermission(
          VALID_USER,
          VALID_COMPANY,
          VALID_BRANCH,
          'users.view',
        ),
      ).resolves.toBe(false);
    });

    it.each(['INACTIVE', 'SUSPENDED'])(
      'denies when the company is %s',
      async (status) => {
        prisma.company.findUnique.mockResolvedValue({ status });
        await expect(
          service.hasBranchPermission(
            VALID_USER,
            VALID_COMPANY,
            VALID_BRANCH,
            'users.view',
          ),
        ).resolves.toBe(false);
      },
    );

    it('denies when membership is INACTIVE', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue({ status: 'INACTIVE' });
      await expect(
        service.hasBranchPermission(
          VALID_USER,
          VALID_COMPANY,
          VALID_BRANCH,
          'users.view',
        ),
      ).resolves.toBe(false);
    });

    it('denies a malformed branch id without hitting the branch table', async () => {
      await expect(
        service.hasBranchPermission(VALID_USER, VALID_COMPANY, 'nope', 'users.view'),
      ).resolves.toBe(false);
      expect(prisma.branch.findUnique).not.toHaveBeenCalled();
    });
  });


  describe('hasCompanyStatusPermission (lifecycle recovery scope)', () => {
    it('allows a member with the permission even when the company is INACTIVE', async () => {
      // This is the whole point: a disabled company must remain recoverable by
      // its own administrators, so this check omits isCompanyOperational().
      prisma.company.findUnique.mockResolvedValue({ status: 'INACTIVE' });
      await expect(
        service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(true);
    });

    it('allows it for a SUSPENDED company too — the transition rule lives in the service', async () => {
      prisma.company.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
      await expect(
        service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(true);
    });

    it('still requires an ACTIVE membership', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue({ status: 'INACTIVE' });
      await expect(
        service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(false);
    });

    it('denies a non-member outright — cross-company recovery is inexpressible', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue(null);
      await expect(
        service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(false);
    });

    it('still requires the permission itself', async () => {
      await expect(
        service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'companies.disable'),
      ).resolves.toBe(false);
    });

    it('resolves permissions from roles inside that company only', async () => {
      await service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'users.view');
      expect(prisma.userBranchRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: VALID_USER, branch: { company_id: VALID_COMPANY } },
        }),
      );
    });

    it('is the ONLY check that skips the company-status precondition', async () => {
      prisma.company.findUnique.mockResolvedValue({ status: 'INACTIVE' });

      await expect(
        service.hasCompanyPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(false);
      await expect(
        service.hasBranchPermission(VALID_USER, VALID_COMPANY, VALID_BRANCH, 'users.view'),
      ).resolves.toBe(false);
      await expect(
        service.hasCompanyStatusPermission(VALID_USER, VALID_COMPANY, 'users.view'),
      ).resolves.toBe(true);
    });
  });

  it('never consults is_superadmin anywhere in the authorization chain', async () => {
    // The user row is never fetched at all: superadmin cannot influence a decision.
    await service.hasCompanyPermission(VALID_USER, VALID_COMPANY, 'users.view');
    await service.hasBranchPermission(
      VALID_USER,
      VALID_COMPANY,
      VALID_BRANCH,
      'users.view',
    );
    expect((prisma as Record<string, unknown>).user).toBeUndefined();
  });
});
