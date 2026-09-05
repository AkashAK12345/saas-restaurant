import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuditEventType } from '@samco/database';
import type { CreateBranchDto, UpdateBranchDto } from './branches.dto.js';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Branch CRUD ─────────────────────────────────────────────────────────────

  /**
   * Returns all branches belonging to the authorized company.
   * The companyId is the guard-verified company context — not raw client input.
   */
  async listBranches(companyId: string) {
    return this.prisma.branch.findMany({
      where: { company_id: companyId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Returns a branch only if it belongs to the authorized company.
   * Explicitly scopes by both id AND company_id in a single query —
   * never fetches globally and then checks.
   */
  async getBranch(branchId: string, companyId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        company_id: companyId, // tenant isolation enforced in query
      },
    });

    // 404 instead of 403 to prevent cross-company branch enumeration
    if (!branch) throw new NotFoundException();
    return branch;
  }

  /**
   * Creates a new branch in the authorized company.
   * The company context comes from the guard-verified X-Company-ID.
   * Verifies the company exists before creating.
   */
  async createBranch(companyId: string, dto: CreateBranchDto, actorUserId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          company_id: companyId,
          name: dto.name,
          timezone: dto.timezone,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          branchId: branch.id,
          eventType: AuditEventType.CREATE,
          entityType: 'BRANCH',
          entityId: branch.id,
          payload: { name: dto.name, timezone: dto.timezone },
        },
        tx,
      );

      return branch;
    });
  }

  /**
   * Updates a branch's fields.
   * Verifies the branch belongs to the authorized company before updating.
   * company_id is never updated — branch company ownership is immutable.
   *
   * Correct scoping: query includes both branch id AND company_id.
   * Never fetches globally then verifies.
   */
  async updateBranch(branchId: string, companyId: string, dto: UpdateBranchDto, actorUserId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        company_id: companyId, // tenant isolation enforced in query
      },
    });

    if (!branch) throw new NotFoundException();

    // Defensive check: reject any attempt to change company_id
    // (should be impossible via DTO, but enforced at service layer too)
    if ('company_id' in dto) {
      throw new ForbiddenException('Branch company ownership is immutable');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.branch.update({
        where: { id: branchId },
        data: {
          name: dto.name,
          timezone: dto.timezone,
          status: dto.status,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          branchId: branch.id,
          eventType: AuditEventType.UPDATE,
          entityType: 'BRANCH',
          entityId: branch.id,
          payload: { changed_fields: Object.keys(dto) },
        },
        tx,
      );

      return updated;
    });
  }
}
