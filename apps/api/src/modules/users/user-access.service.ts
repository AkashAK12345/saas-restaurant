import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditEventType, BranchStatus, MembershipStatus, Prisma, type UserType } from '@samco/database';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import {
  accessCatalogue,
  normalizeSelection,
  permissionsFor,
  selectionFromPermissions,
  typeFromPermissions,
  type AccessSelection,
  type UserTypeKey,
} from './user-access.js';
import type { CreateUserAccessDto, SaveUserAccessDto } from './user-access.dto.js';

type Tx = Prisma.TransactionClient;

export interface UserListEntry {
  id: string;
  email: string;
  name: string;
  status: string;
  user_type: UserTypeKey;
  corporate: boolean;
  branch: { id: string; name: string } | null;
}

export interface UserAccessDetail extends UserListEntry {
  access: AccessSelection;
  /** False until saved on User Management: the form shows what shared roles give. */
  managed: boolean;
}

/**
 * User Management: members, and the access each one is given as toggles.
 *
 * Saving a member's access writes it two ways at once. The membership keeps
 * the selection (what the form shows); a role that belongs to that member
 * alone carries the permission keys it expands to (what every endpoint
 * checks). The member's other role assignments in this company are replaced,
 * so the toggles are the whole truth about what they can do here.
 *
 * Containment, as for shared roles: nobody changes their own access, and
 * nobody grants a key they do not hold themselves.
 */
@Injectable()
export class UserAccessService {
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** The form's catalogue, and the active branches a member can be placed at. */
  async catalogue(companyId: string) {
    return { ...accessCatalogue(), branches: await this.activeBranches(companyId) };
  }

  /** Every active member, with the branch and type the list shows. */
  async list(companyId: string): Promise<UserListEntry[]> {
    const [memberships, activeBranches] = await Promise.all([
      this.prisma.companyMembership.findMany({
        where: { company_id: companyId, status: MembershipStatus.ACTIVE },
        include: { user: true, home_branch: { select: { id: true, name: true } } },
      }),
      this.activeBranches(companyId),
    ]);
    const legacy = await this.legacyAccess(
      companyId,
      memberships.filter((m) => !m.user_type).map((m) => m.user_id),
    );
    return memberships
      .map((m) => this.entry(m, legacy.get(m.user_id), activeBranches))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async detail(companyId: string, userId: string): Promise<UserAccessDetail> {
    const membership = await this.prisma.companyMembership.findUnique({
      where: { user_id_company_id: { user_id: userId, company_id: companyId } },
      include: { user: true, home_branch: { select: { id: true, name: true } } },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) throw new NotFoundException();

    const legacy = membership.user_type
      ? undefined
      : (await this.legacyAccess(companyId, [userId])).get(userId);
    const entry = this.entry(membership, legacy, await this.activeBranches(companyId));
    const access = membership.access
      ? normalizeSelection(membership.access as unknown as AccessSelection)
      : selectionFromPermissions(legacy?.permissions ?? new Set());
    return { ...entry, access, managed: membership.user_type !== null };
  }

  async create(companyId: string, actorUserId: string, dto: CreateUserAccessDto): Promise<UserAccessDetail> {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('A user with this email already exists');
    }
    const plan = await this.plan(companyId, actorUserId, dto);
    const password_hash = await bcrypt.hash(dto.password, this.saltRounds);

    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, password_hash } });
      await tx.companyMembership.create({
        data: { user_id: user.id, company_id: companyId, status: MembershipStatus.ACTIVE },
      });
      await this.apply(tx, companyId, user.id, plan);
      await this.audit.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.CREATE,
          entityType: 'USER',
          entityId: user.id,
          payload: { email, membership_created: true, ...this.auditOf(plan) },
        },
        tx,
      );
      return user.id;
    });
    return this.detail(companyId, userId);
  }

  async save(
    companyId: string,
    actorUserId: string,
    userId: string,
    dto: SaveUserAccessDto,
  ): Promise<UserAccessDetail> {
    if (userId === actorUserId) throw new ForbiddenException('You cannot change your own access');
    const membership = await this.prisma.companyMembership.findUnique({
      where: { user_id_company_id: { user_id: userId, company_id: companyId } },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) throw new NotFoundException();
    const plan = await this.plan(companyId, actorUserId, dto);

    await this.prisma.$transaction(async (tx) => {
      await this.apply(tx, companyId, userId, plan);
      await this.audit.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'USER',
          entityId: userId,
          payload: { action: 'access', ...this.auditOf(plan) },
        },
        tx,
      );
    });
    return this.detail(companyId, userId);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Validates a request and works out everything it will write. */
  private async plan(companyId: string, actorUserId: string, dto: SaveUserAccessDto) {
    const selection = normalizeSelection(dto.access);
    const type = dto.user_type;
    const branches = await this.activeBranches(companyId);

    let branchIds: string[];
    let homeBranchId: string | null = null;
    if (dto.corporate) {
      branchIds = branches.map((b) => b.id);
    } else {
      const branch = branches.find((b) => b.id === dto.branch_id);
      if (!branch) throw new UnprocessableEntityException('Choose an active branch of this company');
      branchIds = [branch.id];
      homeBranchId = branch.id;
    }

    const keys = permissionsFor(type, selection);
    const held = await this.authorization.getEffectiveCompanyPermissions(actorUserId, companyId);
    const notHeld = keys.filter((k) => !held.has(k));
    if (notHeld.length > 0) {
      throw new ForbiddenException(`You cannot give access you do not have yourself: ${notHeld.join(', ')}`);
    }

    const permissions = await this.prisma.permission.findMany({
      where: { name: { in: keys } },
      select: { id: true },
    });
    if (permissions.length !== keys.length) {
      throw new UnprocessableEntityException('The permission catalogue is out of date — run the permission seed');
    }

    return {
      type,
      selection,
      corporate: dto.corporate,
      homeBranchId,
      branchIds,
      permissionIds: permissions.map((p) => p.id),
      keyCount: keys.length,
    };
  }

  /** Writes a plan: the member's personal role, its branches, the selection. */
  private async apply(tx: Tx, companyId: string, userId: string, plan: Awaited<ReturnType<UserAccessService['plan']>>) {
    const role =
      (await tx.role.findUnique({
        where: { company_id_personal_user_id: { company_id: companyId, personal_user_id: userId } },
      })) ??
      (await tx.role.create({
        data: {
          company_id: companyId,
          personal_user_id: userId,
          name: `personal:${userId}`,
          description: 'Access set on User Management',
        },
      }));

    await tx.rolePermission.deleteMany({ where: { role_id: role.id } });
    await tx.rolePermission.createMany({
      data: plan.permissionIds.map((permission_id) => ({ role_id: role.id, permission_id })),
    });

    // The toggles are the whole truth: shared roles held here before go.
    await tx.userBranchRole.deleteMany({ where: { user_id: userId, branch: { company_id: companyId } } });
    await tx.userBranchRole.createMany({
      data: plan.branchIds.map((branch_id) => ({ user_id: userId, branch_id, role_id: role.id })),
    });

    await tx.companyMembership.update({
      where: { user_id_company_id: { user_id: userId, company_id: companyId } },
      data: {
        user_type: plan.type as UserType,
        is_corporate: plan.corporate,
        home_branch_id: plan.homeBranchId,
        access: plan.selection as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private auditOf(plan: Awaited<ReturnType<UserAccessService['plan']>>) {
    return {
      user_type: plan.type,
      corporate: plan.corporate,
      branch_id: plan.homeBranchId,
      toggles: plan.selection.toggles,
      routines: plan.selection.routines,
      tasks: plan.selection.tasks,
      permission_count: plan.keyCount,
    };
  }

  private activeBranches(companyId: string) {
    return this.prisma.branch.findMany({
      where: { company_id: companyId, status: BranchStatus.ACTIVE },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * For members not yet saved on User Management: the branches their shared
   * roles cover and the keys those roles hold, so the list and the form can
   * say what they can do today.
   */
  private async legacyAccess(companyId: string, userIds: string[]) {
    const result = new Map<string, { branches: Map<string, string>; permissions: Set<string> }>();
    if (userIds.length === 0) return result;
    const rows = await this.prisma.userBranchRole.findMany({
      where: { user_id: { in: userIds }, branch: { company_id: companyId } },
      include: {
        branch: { select: { id: true, name: true } },
        role: { include: { permissions: { include: { permission: { select: { name: true } } } } } },
      },
    });
    for (const row of rows) {
      const entry = result.get(row.user_id) ?? { branches: new Map(), permissions: new Set<string>() };
      entry.branches.set(row.branch.id, row.branch.name);
      for (const rp of row.role.permissions) entry.permissions.add(rp.permission.name);
      result.set(row.user_id, entry);
    }
    return result;
  }

  private entry(
    m: {
      user_id: string;
      user_type: UserType | null;
      is_corporate: boolean;
      home_branch: { id: string; name: string } | null;
      user: { email: string; first_name: string | null; last_name: string | null; status: string };
    },
    legacy: { branches: Map<string, string>; permissions: Set<string> } | undefined,
    activeBranches: { id: string; name: string }[],
  ): UserListEntry {
    const name =
      [m.user.first_name, m.user.last_name].filter(Boolean).join(' ').trim() || m.user.email.split('@')[0];
    const base = { id: m.user_id, email: m.user.email, name, status: m.user.status };
    if (m.user_type) {
      return { ...base, user_type: m.user_type, corporate: m.is_corporate, branch: m.home_branch };
    }
    // Before User Management: roles at every branch read as Corporate.
    const held = legacy?.branches ?? new Map<string, string>();
    const corporate = activeBranches.length > 1 && activeBranches.every((b) => held.has(b.id));
    const first = [...held.entries()].sort((a, b) => a[1].localeCompare(b[1]))[0];
    return {
      ...base,
      user_type: typeFromPermissions(legacy?.permissions ?? new Set()),
      corporate,
      branch: corporate || !first ? null : { id: first[0], name: first[1] },
    };
  }
}
