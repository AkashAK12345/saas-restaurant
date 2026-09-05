import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
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
  ) {}

  // ── Role CRUD ──────────────────────────────────────────────────────────────

  /**
   * List all roles belonging to the requested company.
   * Never returns roles from other companies.
   */
  async listRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: { company_id: companyId },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: { name: 'asc' },
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

    if (!role || role.company_id !== companyId) throw new NotFoundException();
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
    if (!role || role.company_id !== companyId) throw new NotFoundException();

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
   *
   * Uses a transaction: deletes existing assignments, creates new ones.
   */
  async setRolePermissions(
    roleId: string,
    companyId: string,
    dto: SetRolePermissionsDto,
    actorUserId: string,
  ) {
    // Scope check
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.company_id !== companyId) throw new NotFoundException();

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
