import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MembershipStatus, AuditEventType } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
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
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class UsersService {
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private sanitize(user: {
    id: string;
    email: string;
    password_hash: string;
    first_name: string | null;
    last_name: string | null;
    is_superadmin: boolean;
    created_at: Date;
    updated_at: Date;
  }): SafeUser {
    // Explicitly exclude password_hash — never returned to clients
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

      const branchRoles = await this.prisma.userBranchRole.findMany({
        where: { branch_id: branchId },
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

    if (!membership) throw new NotFoundException();
    return this.sanitize(membership.user);
  }

  /**
   * Create a new global User record.
   * Does NOT create CompanyMembership. Membership must be assigned separately.
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

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.CREATE,
          entityType: 'USER',
          entityId: user.id,
          payload: { email },
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
    // Scope check: target user must be in this company
    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: targetUserId, company_id: companyId },
      },
    });
    if (!membership) throw new NotFoundException();

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

  // ── Branch-Role Assignment ─────────────────────────────────────────────────

  /**
   * Assign a role to a user at a branch.
   *
   * Cross-entity invariants verified explicitly (not relying solely on FK constraints):
   *   1. target user has ACTIVE CompanyMembership for the company owning the branch
   *   2. branch belongs to the requested company
   *   3. role belongs to the requested company
   *
   * Idempotent: if the identical assignment already exists, returns it.
   */
  async assignBranchRole(
    targetUserId: string,
    companyId: string,
    dto: AssignBranchRoleDto,
    actorUserId: string,
  ) {
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
    });
    if (!role || role.company_id !== companyId) {
      throw new UnprocessableEntityException(
        'Role does not belong to this company',
      );
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
   * Verifies the assignment belongs to the requesting company context.
   */
  async removeBranchRole(
    targetUserId: string,
    companyId: string,
    assignmentId: string,
    actorUserId: string,
  ): Promise<void> {
    const assignment = await this.prisma.userBranchRole.findUnique({
      where: { id: assignmentId },
      include: { branch: true },
    });

    // 404 if not found, wrong user, or wrong company — do not reveal existence
    if (
      !assignment ||
      assignment.user_id !== targetUserId ||
      assignment.branch.company_id !== companyId
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
