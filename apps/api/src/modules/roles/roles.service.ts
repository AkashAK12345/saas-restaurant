import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { AuditEventType } from '@samco/database';
import type {
  CreateRoleDto,
  UpdateRoleDto,
  SetRolePermissionsDto,
} from './roles.dto.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  // ── Role CRUD ──────────────────────────────────────────────────────────────

  /**
   * List all roles belonging to the requested company.
   * Never returns roles from other companies.
   */
  async listRoles(companyId: string) {
    return this.prisma.role.findMany({
      // Personal roles hold one member's User Management access; not shared.
      where: { company_id: companyId, personal_user_id: null },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** The seeded, system-defined permission catalogue. Not tenant data. */
  async listPermissionCatalogue() {
    return this.prisma.permission.findMany({
      select: { name: true, module: true, description: true },
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Get a single role — only if it belongs to the requested company.
   * Returns 404 if not in scope (prevents cross-company role enumeration).
   */
  async getRole(roleId: string, companyId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    // A member's personal role (User Management) is theirs alone: never read
    // or edited as a shared role.
    if (!role || role.company_id !== companyId || role.personal_user_id !== null) throw new NotFoundException();
    return role;
  }

  /**
   * Create a new role scoped to the requesting company.
   * Role names must be unique within a company.
   */
  async createRole(companyId: string, dto: CreateRoleDto, actorUserId: string) {
    // Verify the company exists to produce a clean error rather than a FK violation
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');

    // Check name uniqueness within company
    const existing = await this.prisma.role.findUnique({
      where: { company_id_name: { company_id: companyId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(`A role named "${dto.name}" already exists in this company`);
    }

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          company_id: companyId,
          name: dto.name,
          description: dto.description ?? null,
        },
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.CREATE,
          entityType: 'ROLE',
          entityId: role.id,
          payload: { name: dto.name },
        },
        tx,
      );

      return role;
    });
  }

  /**
   * Update a role's name or description.
   * Target role must belong to the requesting company.
   */
  async updateRole(roleId: string, companyId: string, dto: UpdateRoleDto, actorUserId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    // A member's personal role (User Management) is theirs alone: never read
    // or edited as a shared role.
    if (!role || role.company_id !== companyId || role.personal_user_id !== null) throw new NotFoundException();

    if (dto.name && dto.name !== role.name) {
      const existing = await this.prisma.role.findUnique({
        where: { company_id_name: { company_id: companyId, name: dto.name } },
      });
      if (existing) {
        throw new ConflictException(`A role named "${dto.name}" already exists in this company`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id: roleId },
        data: {
          name: dto.name,
          description: dto.description,
        },
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'ROLE',
          entityId: roleId,
          payload: { changed_fields: Object.keys(dto) },
        },
        tx,
      );

      return updated;
    });
  }

  // ── Role-Permission Management ─────────────────────────────────────────────

  /**
   * Atomically replace the full set of permissions on a role.
   * Validates that:
   *   - The role belongs to the requesting company
   *   - Every supplied permission name exists as a system-defined Permission record
   *   - Clients cannot create arbitrary permission definitions
   *   - The actor does not introduce any permission they do not themselves hold
   *
   * Uses a transaction: deletes existing assignments, creates new ones.
   */
  async setRolePermissions(
    roleId: string,
    companyId: string,
    dto: SetRolePermissionsDto,
    actorUserId: string,
  ) {
    // Scope check. Existing permissions are loaded here so we can determine
    // which names this request is *adding* to the role.
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    // A member's personal role (User Management) is theirs alone: never read
    // or edited as a shared role.
    if (!role || role.company_id !== companyId || role.personal_user_id !== null) throw new NotFoundException();

    // Validate every supplied permission name exists in the Permission table
    const permissionNames = [...new Set(dto.permissions)]; // deduplicate

    let permissionRecords: { id: string; name: string }[] = [];
    if (permissionNames.length > 0) {
      permissionRecords = await this.prisma.permission.findMany({
        where: { name: { in: permissionNames } },
        select: { id: true, name: true },
      });

      const foundNames = new Set(permissionRecords.map((p) => p.name));
      const invalidNames = permissionNames.filter((n) => !foundNames.has(n));
      if (invalidNames.length > 0) {
        throw new BadRequestException(
          `Invalid or unknown permission names: ${invalidNames.join(', ')}`,
        );
      }
    }

    // ── Privilege-escalation containment ────────────────────────────────────
    //
    // `roles.update` must not be a universal permission-granting capability.
    // An actor may only ADD permissions they themselves effectively hold in
    // this company; without this, any holder of `roles.update` could write
    // arbitrary permissions onto their own role and become a full company
    // administrator (and could equally escalate a confederate's role).
    //
    // Only additions are constrained. Permissions already on the role may be
    // retained or removed, so an actor editing a role that outranks them can
    // still work without being forced to strip its existing capabilities.
    //
    // The actor's effective permission set is resolved server-side through the
    // same AuthorizationService the PermissionGuard uses — never from client
    // input — so the company/branch RBAC model stays the single source of
    // truth. is_superadmin is deliberately not consulted.
    const currentNames = new Set(role.permissions.map((rp) => rp.permission.name));
    const addedNames = permissionNames.filter((n) => !currentNames.has(n));

    if (addedNames.length > 0) {
      const actorPermissions =
        await this.authorizationService.getEffectiveCompanyPermissions(
          actorUserId,
          companyId,
        );
      const notHeld = addedNames.filter((n) => !actorPermissions.has(n));
      if (notHeld.length > 0) {
        throw new ForbiddenException(
          `Cannot grant permissions you do not hold: ${notHeld.join(', ')}`,
        );
      }
    }

    // Atomic replace: delete all then recreate
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role_id: roleId } });
      
      if (permissionRecords.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionRecords.map((p) => ({
            role_id: roleId,
            permission_id: p.id,
          })),
        });
      }

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'ROLE_PERMISSION',
          entityId: roleId,
          payload: { permissions: permissionNames },
        },
        tx,
      );
    });

    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
  }
}
