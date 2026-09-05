import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { MembershipStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true if the user has an ACTIVE CompanyMembership for the given company.
   * This is the foundational membership check for all company-scoped operations.
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
   *   1. User has ACTIVE CompanyMembership for the company
   *   2. User holds the required permission via any branch role in that company
   */
  async hasCompanyPermission(
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
   *   1. User has ACTIVE CompanyMembership for the company
   *   2. Branch belongs to the requested company (cross-company isolation)
   *   3. User holds the required permission via their roles at that specific branch
   */
  async hasBranchPermission(
    userId: string,
    companyId: string,
    branchId: string,
    permission: string,
  ): Promise<boolean> {
    const hasMembership = await this.hasActiveMembership(userId, companyId);
    if (!hasMembership) return false;

    // Verify branch belongs to the claimed company — prevents cross-company branch spoofing
    if (!isUUID(branchId)) return false;
    
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.company_id !== companyId) return false;

    const perms = await this.getEffectiveBranchPermissions(userId, branchId);
    return perms.has(permission);
  }
}
