import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { MembershipStatus, AuditEventType, UserStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import * as bcrypt from 'bcrypt';
import type {
  CreateUserDto,
  UpdateUserDto,
  AssignBranchRoleDto,
} from './users.dto.js';

type SafeUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_superadmin: boolean;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class UsersService {
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private sanitize(user: {
    id: string;
    email: string;
    password_hash: string;
    first_name: string | null;
    last_name: string | null;
    is_superadmin: boolean;
    status: UserStatus;
    created_at: Date;
    updated_at: Date;
  }): SafeUser {
    // Explicitly exclude password_hash — never returned to clients.
    // Destructuring by name means any future column is included by default,
    // so new sensitive fields must be added here deliberately.
    const { password_hash: _ph, ...safe } = user;
    return safe;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  // ── User CRUD ──────────────────────────────────────────────────────────────

  /**
   * List all users with ACTIVE CompanyMembership for the given company.
   * Optionally narrows results to users with any branch role at a specific branch.
   * The branch, if provided, must belong to the company.
   */
  async listUsers(companyId: string, branchId?: string): Promise<SafeUser[]> {
    if (branchId) {
      // Verify branch belongs to company to prevent cross-company data leakage
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch || branch.company_id !== companyId) {
        throw new NotFoundException();
      }

      // Only users with an ACTIVE company membership are listed. A deactivated
      // member can still hold stale UserBranchRole rows, and filtering on the
      // role alone would keep surfacing them as if they were current staff.
      const branchRoles = await this.prisma.userBranchRole.findMany({
        where: {
          branch_id: branchId,
          user: {
            memberships: {
              some: {
                company_id: companyId,
                status: MembershipStatus.ACTIVE,
              },
            },
          },
        },
        include: { user: true },
      });

      // Deduplicate users who hold multiple roles at the branch
      const seen = new Set<string>();
      const users: SafeUser[] = [];
      for (const br of branchRoles) {
        if (!seen.has(br.user.id)) {
          seen.add(br.user.id);
          users.push(this.sanitize(br.user));
        }
      }
      return users;
    }

    const memberships = await this.prisma.companyMembership.findMany({
      where: { company_id: companyId, status: MembershipStatus.ACTIVE },
      include: { user: true },
    });

    return memberships.map((m) => this.sanitize(m.user));
  }

  /**
   * Get a single user — only if they have a CompanyMembership for the requested company.
   * Returns 404 if the user is not in scope (prevents cross-company data leakage).
   */
  async getUser(userId: string, companyId: string): Promise<SafeUser> {
    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: userId, company_id: companyId },
      },
      include: { user: true },
    });

    // ACTIVE required, not merely present: a deactivated membership must not
    // keep granting read access to the member's record.
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException();
    }
    return this.sanitize(membership.user);
  }

  /**
   * Create a user within the authorized company.
   *
   * `users.create` is a COMPANY-scoped permission, so the operation it authorizes
   * must be scoped to that company too. Previously this created a bare global
   * User row and no CompanyMembership, leaving an orphaned account that belonged
   * to nobody, appeared in no company's user list, and could not be managed or
   * deactivated through any company-scoped endpoint.
   *
   * The user record and its ACTIVE membership in the acting company are now
   * created in one transaction with the audit entry.
   *
   * Adding an EXISTING global user to a company remains a separate, explicit
   * operation (POST /companies/:id/members, guarded by memberships.create) —
   * this endpoint deliberately does not silently absorb existing accounts.
   *
   * Clients cannot set is_superadmin or password_hash.
   */
  async createUser(dto: CreateUserDto, actorUserId: string, companyId: string): Promise<SafeUser> {
    const email = this.normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const password_hash = await bcrypt.hash(dto.password, this.saltRounds);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password_hash,
          first_name: dto.first_name ?? null,
          last_name: dto.last_name ?? null,
          // is_superadmin deliberately omitted — defaults to false in schema
        },
      });

      await tx.companyMembership.create({
        data: {
          user_id: user.id,
          company_id: companyId,
          status: MembershipStatus.ACTIVE,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.CREATE,
          entityType: 'USER',
          entityId: user.id,
          payload: { email, membership_created: true },
        },
        tx,
      );

      return this.sanitize(user);
    });
  }

  /**
   * Update a user's display fields.
   * The target user must be a member of the requesting company.
   * Clients cannot update email, password, or is_superadmin.
   */
  async updateUser(
    targetUserId: string,
    companyId: string,
    dto: UpdateUserDto,
    actorUserId: string,
  ): Promise<SafeUser> {
    // Scope check: target user must be an ACTIVE member of this company.
    // Re-activating a membership goes through the memberships API, not here.
    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: targetUserId, company_id: companyId },
      },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException();
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: {
          first_name: dto.first_name,
          last_name: dto.last_name,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'USER',
          entityId: targetUserId,
          payload: { changed_fields: Object.keys(dto) },
        },
        tx,
      );

      return this.sanitize(user);
    });
  }

  /**
   * Change a user's GLOBAL account status.
   *
   * GLOBAL USER DISABLE vs COMPANY MEMBERSHIP INACTIVATION
   * ------------------------------------------------------
   * These are separate concepts and this endpoint implements only the first:
   *
   *   UserStatus.INACTIVE       the person cannot sign in to SAMCO at all
   *   MembershipStatus.INACTIVE the person is no longer part of ONE company
   *
   * Removing an employee from your company is a MEMBERSHIP operation
   * (PATCH /companies/:id/members/:membershipId). It must not, and does not,
   * touch global account status.
   *
   * SECURITY POLICY — why a company-scoped permission may act globally:
   * `users.disable` is company-scoped, but the effect here is platform-wide, so
   * the blast radius is constrained to users who belong to NOBODY ELSE:
   *
   *   1. actor holds users.disable in the company (PermissionGuard)
   *   2. target has an ACTIVE membership in that same company
   *   3. target belongs to NO OTHER company — otherwise a company A admin could
   *      disable a user's access to company B, which is a cross-company action
   *      they have no authority over. Such users must be removed via membership.
   *   4. target is not the actor — prevents self-lockout
   *   5. target is not a platform superadmin — a customer admin must not be able
   *      to lock out a platform operator. This is a RESTRICTION, never a grant:
   *      is_superadmin still confers no authorization anywhere.
   *
   * Disabling also revokes the target's sessions so access stops immediately
   * rather than at token expiry.
   */
  async setUserStatus(
    targetUserId: string,
    companyId: string,
    newStatus: UserStatus,
    actorUserId: string,
  ): Promise<SafeUser> {
    if (targetUserId === actorUserId) {
      throw new ForbiddenException('You cannot change your own account status');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { memberships: true },
    });

    // 404 rather than 403 for a user outside this company — do not disclose
    // the existence of accounts the caller cannot see.
    const membershipHere = target?.memberships.find(
      (m) => m.company_id === companyId,
    );
    if (!target || !membershipHere || membershipHere.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException();
    }

    if (target.is_superadmin) {
      throw new ForbiddenException(
        'Platform superadmin accounts cannot be modified through a company-scoped operation',
      );
    }

    const otherCompanies = target.memberships.filter(
      (m) => m.company_id !== companyId,
    );
    if (otherCompanies.length > 0) {
      throw new UnprocessableEntityException(
        'This user belongs to other companies; a company-scoped operation cannot ' +
          'change their global account status. Deactivate their membership instead.',
      );
    }

    if (target.status === newStatus) {
      return this.sanitize(target);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status: newStatus },
      });

      // Stop existing access immediately. JwtStrategy also rejects disabled
      // accounts, so this is defence in depth rather than the only control.
      if (newStatus === UserStatus.INACTIVE) {
        await tx.userSession.updateMany({
          where: { user_id: targetUserId, revoked_at: null },
          data: { revoked_at: new Date() },
        });
      }

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.SECURITY,
          entityType: 'USER_STATUS',
          entityId: targetUserId,
          payload: {
            target_user_id: targetUserId,
            from: target.status,
            to: newStatus,
          },
        },
        tx,
      );

      return this.sanitize(updated);
    });
  }

  // ── Branch-Role Assignment ─────────────────────────────────────────────────

  /**
   * A member's role assignments, limited to branches of the requested company.
   * The membership check runs first so a user outside the company is a 404,
   * never an empty list that would confirm the account exists.
   */
  async listBranchRoles(userId: string, companyId: string) {
    await this.getUser(userId, companyId);
    return this.prisma.userBranchRole.findMany({
      where: { user_id: userId, branch: { company_id: companyId } },
      select: {
        id: true,
        branch: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
      },
      orderBy: [{ branch: { name: 'asc' } }, { role: { name: 'asc' } }],
    });
  }

  /**
   * Assign a role to a user at a branch.
   *
   * `branchContextId` is the guard-verified X-Branch-ID the PermissionGuard
   * authorized this request against — never raw client input treated as proof.
   *
   * Cross-entity invariants verified explicitly (not relying solely on FK constraints):
   *   0. the mutation target branch is the same branch the actor was authorized for
   *   1. branch belongs to the requested company
   *   2. role belongs to the requested company
   *   3. target user has ACTIVE CompanyMembership for the company owning the branch
   *
   * Idempotent: if the identical assignment already exists, returns it.
   */
  async assignBranchRole(
    targetUserId: string,
    companyId: string,
    branchContextId: string | undefined,
    dto: AssignBranchRoleDto,
    actorUserId: string,
  ) {
    // Invariant 0: authorization context and mutation target must be the same branch.
    //
    // The PermissionGuard verified `users.update` at branchContextId. Writing to
    // any other branch would let a manager authorized at one branch mutate role
    // assignments at another. This check runs before all business validation so
    // the request fails closed on authorization first.
    if (!branchContextId) {
      throw new ForbiddenException('Missing required branch context (X-Branch-ID)');
    }
    if (dto.branch_id !== branchContextId) {
      throw new ForbiddenException(
        'Branch ID in request body does not match authorized branch context (X-Branch-ID)',
      );
    }

    // Nobody grants themselves a role. Without this, users.update alone would
    // let its holder give themselves any role the company has defined.
    if (targetUserId === actorUserId) {
      throw new ForbiddenException('You cannot assign a role to yourself');
    }

    // Invariant 1: branch belongs to company
    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branch_id },
    });
    if (!branch || branch.company_id !== companyId) {
      throw new UnprocessableEntityException(
        'Branch does not belong to this company',
      );
    }

    // Invariant 2: role belongs to company
    const role = await this.prisma.role.findUnique({
      where: { id: dto.role_id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role || role.company_id !== companyId) {
      throw new UnprocessableEntityException(
        'Role does not belong to this company',
      );
    }

    // ── Privilege-escalation containment ──────────────────────────────────
    //
    // The same rule setRolePermissions enforces, applied to the other way a
    // permission reaches a person. Assigning a role hands over every
    // permission it contains, so an actor may only assign a role whose
    // permissions they already hold in this company. Otherwise `users.update`
    // at one branch would be a route to company administrator — for a
    // confederate, and, before the self-assignment check above, for oneself.
    //
    // Resolved server-side through the same AuthorizationService the guard
    // uses; is_superadmin is deliberately not consulted.
    if (role.permissions.length > 0) {
      const actorPermissions = await this.authorizationService.getEffectiveCompanyPermissions(
        actorUserId,
        companyId,
      );
      const notHeld = role.permissions
        .map((rp) => rp.permission.name)
        .filter((name) => !actorPermissions.has(name));
      if (notHeld.length > 0) {
        throw new ForbiddenException(
          `Cannot assign a role carrying permissions you do not hold: ${notHeld.join(', ')}`,
        );
      }
    }

    // Invariant 3: target user has ACTIVE membership in the company
    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: targetUserId, company_id: companyId },
      },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new UnprocessableEntityException(
        'Target user is not an active member of this company',
      );
    }

    // Idempotent: return existing assignment if it already exists
    const existing = await this.prisma.userBranchRole.findUnique({
      where: {
        user_id_branch_id_role_id: {
          user_id: targetUserId,
          branch_id: dto.branch_id,
          role_id: dto.role_id,
        },
      },
    });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.userBranchRole.create({
        data: {
          user_id: targetUserId,
          branch_id: dto.branch_id,
          role_id: dto.role_id,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          branchId: dto.branch_id,
          eventType: AuditEventType.CREATE,
          entityType: 'USER_BRANCH_ROLE',
          entityId: assignment.id,
          payload: { target_user_id: targetUserId, role_id: dto.role_id },
        },
        tx,
      );

      return assignment;
    });
  }

  /**
   * Remove a user-branch-role assignment.
   *
   * `branchContextId` is the guard-verified X-Branch-ID. The assignment must
   * live at that branch: a branch-scoped actor may only remove assignments
   * inside the branch they were authorized for.
   */
  async removeBranchRole(
    targetUserId: string,
    companyId: string,
    branchContextId: string | undefined,
    assignmentId: string,
    actorUserId: string,
  ): Promise<void> {
    if (!branchContextId) {
      throw new ForbiddenException('Missing required branch context (X-Branch-ID)');
    }

    const assignment = await this.prisma.userBranchRole.findUnique({
      where: { id: assignmentId },
      include: { branch: true },
    });

    // 404 if not found, wrong user, wrong company, or outside the authorized
    // branch — a uniform 404 avoids disclosing which assignments exist at
    // branches the actor has no authority over.
    if (
      !assignment ||
      assignment.user_id !== targetUserId ||
      assignment.branch.company_id !== companyId ||
      assignment.branch_id !== branchContextId
    ) {
      throw new NotFoundException();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userBranchRole.delete({ where: { id: assignmentId } });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          branchId: assignment.branch_id,
          eventType: AuditEventType.DELETE,
          entityType: 'USER_BRANCH_ROLE',
          entityId: assignmentId,
          payload: { target_user_id: targetUserId, action: 'removed' },
        },
        tx,
      );
    });
  }
}
