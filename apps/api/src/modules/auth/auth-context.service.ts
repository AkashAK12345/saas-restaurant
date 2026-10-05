import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, UserStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';

/**
 * Shell/context data for a permission-aware frontend.
 *
 * THIS IS A CONVENIENCE PROJECTION, NOT AN AUTHORIZATION SOURCE. Every
 * protected route still runs PermissionGuard against the database on each
 * request; a client that ignores this response gains nothing, and a client
 * that tampers with it loses nothing. It exists so the UI can avoid rendering
 * navigation the backend would reject anyway.
 *
 * Permissions are resolved through the same AuthorizationService the guard
 * uses, so what the UI sees is what the guard will decide — by construction,
 * not by duplication.
 *
 * Chosen over extending GET /auth/me: /me is the lightweight identity check
 * used after login and on every app load; this endpoint performs several
 * membership/role queries and takes optional company/branch context. Keeping
 * them separate keeps /me cheap and its contract unchanged.
 */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async getContext(userId: string, companyId?: string, branchId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, first_name: true, last_name: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException();
    }

    // Companies the user may select: ACTIVE memberships only. Company status is
    // included (not filtered) so the UI can explain a disabled company rather
    // than have it vanish — mirrors GET /companies.
    const memberships = await this.prisma.companyMembership.findMany({
      where: { user_id: userId, status: MembershipStatus.ACTIVE },
      include: { company: { select: { id: true, name: true, status: true } } },
      // Oldest company first: for someone in several (the owner), the original
      // business opens by default rather than whichever sorts first by name.
      orderBy: [{ company: { created_at: 'asc' } }, { company: { name: 'asc' } }],
    });
    const companies = memberships.map((m) => m.company);

    const base = {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
      },
      companies,
      company: null as null | {
        id: string;
        name: string;
        status: string;
        permissions: string[];
        branches: Array<{ id: string; name: string; status: string; timezone: string; has_roles: boolean; roles: string[] }>;
      },
      branch: null as null | { id: string; name: string; status: string; timezone: string; permissions: string[]; roles: string[] },
    };

    if (!companyId) return base;

    // The requested company must be one the user actually belongs to. A company
    // id outside their memberships is a 404 — nothing about it is disclosed,
    // exactly like GET /companies/:id.
    const selected = companies.find((c) => c.id === companyId);
    if (!selected) throw new NotFoundException();

    const [companyPermissions, branches, roleBranchRows] = await Promise.all([
      this.authorization.getEffectiveCompanyPermissions(userId, companyId),
      this.prisma.branch.findMany({
        where: { company_id: companyId },
        select: { id: true, name: true, status: true, timezone: true },
        orderBy: { name: 'asc' },
      }),
      // The ROLE NAMES, not just which branches have one: the shell greets a
      // user by the job they hold here ("Manager"), and a name is not a
      // permission — every request is still authorized from the database.
      this.prisma.userBranchRole.findMany({
        where: { user_id: userId, branch: { company_id: companyId } },
        select: { branch_id: true, role: { select: { name: true } } },
      }),
    ]);
    const rolesByBranch = new Map<string, Set<string>>();
    for (const row of roleBranchRows) {
      const names = rolesByBranch.get(row.branch_id) ?? new Set<string>();
      names.add(row.role.name);
      rolesByBranch.set(row.branch_id, names);
    }
    const rolesAt = (branchId: string) => [...(rolesByBranch.get(branchId) ?? [])].sort();

    base.company = {
      ...selected,
      permissions: [...companyPermissions].sort(),
      branches: branches.map((b) => ({ ...b, has_roles: rolesByBranch.has(b.id), roles: rolesAt(b.id) })),
    };

    if (!branchId) return base;

    // The branch must belong to the selected company — same non-disclosure.
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) throw new NotFoundException();

    const branchPermissions = await this.authorization.getEffectiveBranchPermissions(
      userId,
      branchId,
    );
    base.branch = { ...branch, permissions: [...branchPermissions].sort(), roles: rolesAt(branch.id) };

    return base;
  }
}
