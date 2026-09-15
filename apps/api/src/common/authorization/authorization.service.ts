import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  MembershipStatus,
  CompanyStatus,
  BranchStatus,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true if the user has an ACTIVE CompanyMembership for the given company.
   * This is the foundational membership check for all company-scoped operations.
   *
   * Membership only — company lifecycle status is a separate concern, checked by
   * isCompanyOperational() so the two failures stay distinguishable.
   */
  async hasActiveMembership(userId: string, companyId: string): Promise<boolean> {
    if (!isUUID(userId) || !isUUID(companyId)) return false;

    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: userId, company_id: companyId },
      },
    });
    return !!membership && membership.status === MembershipStatus.ACTIVE;
  }

  /**
   * A company must be ACTIVE for any permission-protected operation to proceed.
   * INACTIVE (customer-closed) and SUSPENDED (platform-imposed, e.g. billing)
   * both deny access.
   *
   * Reactivation is deliberately NOT reachable through company-scoped RBAC —
   * it is a platform-level operation, in the same category as company creation.
   * See BACKLOG in the hardening report.
   */
  async isCompanyOperational(companyId: string): Promise<boolean> {
    if (!isUUID(companyId)) return false;

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    return !!company && company.status === CompanyStatus.ACTIVE;
  }

  /**
   * Resolves the UNION of all permissions for a user across all branches in a company.
   * Used for company-scoped permission checks.
   * A user needs the permission via at least one branch role in the company.
   */
  async getEffectiveCompanyPermissions(
    userId: string,
    companyId: string,
  ): Promise<Set<string>> {
    const branchRoles = await this.prisma.userBranchRole.findMany({
      where: {
        user_id: userId,
        branch: { company_id: companyId },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const effectivePerms = new Set<string>();
    for (const br of branchRoles) {
      for (const rp of br.role.permissions) {
        effectivePerms.add(rp.permission.name);
      }
    }
    return effectivePerms;
  }

  /**
   * Resolves the UNION of all permissions for a user at a specific branch.
   * A user may hold multiple roles at a branch; effective permissions are the union.
   */
  async getEffectiveBranchPermissions(
    userId: string,
    branchId: string,
  ): Promise<Set<string>> {
    const branchRoles = await this.prisma.userBranchRole.findMany({
      where: {
        user_id: userId,
        branch_id: branchId,
      },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const effectivePerms = new Set<string>();
    for (const br of branchRoles) {
      for (const rp of br.role.permissions) {
        effectivePerms.add(rp.permission.name);
      }
    }
    return effectivePerms;
  }

  /**
   * Company-scoped authorization check.
   * Verifies:
   *   1. The company is ACTIVE (not INACTIVE / SUSPENDED)
   *   2. User has ACTIVE CompanyMembership for the company
   *   3. User holds the required permission via any branch role in that company
   */
  async hasCompanyPermission(
    userId: string,
    companyId: string,
    permission: string,
  ): Promise<boolean> {
    if (!(await this.isCompanyOperational(companyId))) return false;

    const hasMembership = await this.hasActiveMembership(userId, companyId);
    if (!hasMembership) return false;

    const perms = await this.getEffectiveCompanyPermissions(userId, companyId);
    return perms.has(permission);
  }

  /**
   * Company LIFECYCLE-TRANSITION authorization check.
   *
   * Deliberately omits the isCompanyOperational() precondition that
   * hasCompanyPermission() enforces — a company being reactivated is by
   * definition not ACTIVE, so requiring ACTIVE here would make disabling a
   * company an unrecoverable action.
   *
   * Everything else is unchanged and still proved server-side:
   *   1. User has ACTIVE CompanyMembership for the company
   *   2. User holds the required permission via a branch role in that company
   *
   * Membership and roles are company-scoped, so this can never authorize a
   * transition on a company the caller is not an active member of.
   *
   * Used only by the company status endpoint. The permitted transitions
   * themselves are additionally constrained in CompaniesService.
   */
  async hasCompanyStatusPermission(
    userId: string,
    companyId: string,
    permission: string,
  ): Promise<boolean> {
    const hasMembership = await this.hasActiveMembership(userId, companyId);
    if (!hasMembership) return false;

    const perms = await this.getEffectiveCompanyPermissions(userId, companyId);
    return perms.has(permission);
  }

  /**
   * Branch-scoped authorization check.
   * Verifies:
   *   1. The company is ACTIVE (not INACTIVE / SUSPENDED)
   *   2. User has ACTIVE CompanyMembership for the company
   *   3. Branch belongs to the requested company (cross-company isolation)
   *   4. The branch itself is ACTIVE
   *   5. User holds the required permission via their roles at that specific branch
   *
   * Note: branch status gates branch-scoped operations only. It deliberately does
   * NOT filter getEffectiveCompanyPermissions — otherwise disabling a company's
   * only branch would strip every company-scoped permission from its
   * administrators, including the branches.update needed to re-enable it.
   */
  async hasBranchPermission(
    userId: string,
    companyId: string,
    branchId: string,
    permission: string,
  ): Promise<boolean> {
    const perms = await this.verifiedBranchPermissions(userId, companyId, branchId);
    return perms !== null && perms.has(permission);
  }

  /**
   * As hasBranchPermission, satisfied by ANY of the listed permissions. Every
   * precondition (operational company, active membership, branch in company
   * and ACTIVE) is identical; only the final test differs. An empty list
   * authorizes nothing.
   */
  async hasAnyBranchPermission(
    userId: string,
    companyId: string,
    branchId: string,
    permissions: readonly string[],
  ): Promise<boolean> {
    const perms = await this.verifiedBranchPermissions(userId, companyId, branchId);
    return perms !== null && permissions.some((p) => perms.has(p));
  }

  /**
   * The caller's verified permission set at a branch — every precondition of
   * hasBranchPermission resolved ONCE — or null when branch access fails.
   *
   * For callers that must test many keys in one request (the report catalogue,
   * the dashboard's widgets) without repeating the company, membership and
   * branch checks per key. It answers exactly what hasBranchPermission would.
   */
  async branchPermissionsFor(
    userId: string,
    companyId: string,
    branchId: string,
  ): Promise<ReadonlySet<string> | null> {
    return this.verifiedBranchPermissions(userId, companyId, branchId);
  }

  /**
   * The caller's permissions at a branch, or null when any precondition of
   * branch-scoped access fails. The single implementation of that chain.
   */
  private async verifiedBranchPermissions(
    userId: string,
    companyId: string,
    branchId: string,
  ): Promise<Set<string> | null> {
    if (!(await this.isCompanyOperational(companyId))) return null;

    const hasMembership = await this.hasActiveMembership(userId, companyId);
    if (!hasMembership) return null;

    // Verify branch belongs to the claimed company — prevents cross-company branch spoofing
    if (!isUUID(branchId)) return null;

    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.company_id !== companyId) return null;

    // A disabled branch cannot be the target of branch-scoped operations
    if (branch.status !== BranchStatus.ACTIVE) return null;

    return this.getEffectiveBranchPermissions(userId, branchId);
  }
}
