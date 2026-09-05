import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MembershipStatus, CompanyStatus, AuditEventType } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type {
  CreateCompanyDto,
  UpdateCompanyDto,
  CreateMembershipDto,
  UpdateMembershipDto,
} from './companies.dto.js';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Company CRUD ────────────────────────────────────────────────────────────

  /**
   * Returns all companies where the authenticated user has an ACTIVE membership.
   * A normal user must never receive companies they do not belong to.
   */
  async listMyCompanies(userId: string) {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { user_id: userId, status: MembershipStatus.ACTIVE },
      include: { company: true },
      orderBy: { company: { name: 'asc' } },
    });
    return memberships.map((m) => m.company);
  }

  /**
   * Returns company details if the authenticated user has an ACTIVE membership.
   * Returns 404 for companies the user cannot see — prevents existence leakage.
   */
  async getCompany(companyId: string, userId: string) {
    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: userId, company_id: companyId },
      },
      include: { company: true },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException();
    }

    return membership.company;
  }

  /**
   * Creates a new company and atomically adds the creating user as an ACTIVE member.
   *
   * PLATFORM ARCHITECTURE NOTE:
   * Company creation is a platform-level operation. The existing RBAC is company-scoped,
   * so there is no company yet to scope a "companies.create" permission against.
   * For Phase 1, any authenticated user may create a company (self-service SaaS model).
   * The creator becomes the first ACTIVE member in the same transaction.
   *
   * Future restriction (e.g. invite-only, billing gate, is_superadmin guard) must be
   * implemented when platform-level permission infrastructure is designed.
   */
  async createCompany(dto: CreateCompanyDto, creatorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.name,
          status: CompanyStatus.ACTIVE,
        },
      });

      await tx.companyMembership.create({
        data: {
          user_id: creatorUserId,
          company_id: company.id,
          status: MembershipStatus.ACTIVE,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId: creatorUserId,
          companyId: company.id,
          eventType: AuditEventType.CREATE,
          entityType: 'COMPANY',
          entityId: company.id,
          payload: { name: dto.name },
        },
        tx,
      );

      return company;
    });
  }

  /**
   * Updates a company's name or status.
   * The calling user must be authorized (verified upstream by PermissionGuard).
   * The companyId here is the guard-verified company context.
   */
  async updateCompany(companyId: string, dto: UpdateCompanyDto, actorUserId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: {
          name: dto.name,
          status: dto.status,
        },
      });

      await this.auditLogService.create(
        {
          actorUserId: actorUserId,
          companyId: companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'COMPANY',
          entityId: companyId,
          payload: { changed_fields: Object.keys(dto) },
        },
        tx,
      );

      return updated;
    });
  }

  // ── Membership Management ───────────────────────────────────────────────────

  /**
   * Lists all memberships for a company.
   * Includes user details (minus password_hash).
   */
  async listMembers(companyId: string) {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { company_id: companyId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            is_superadmin: true,
            created_at: true,
            updated_at: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
    return memberships;
  }

  /**
   * Adds a user to a company.
   * Verifies the target user exists.
   * Handles duplicate membership via ConflictException.
   * The calling user cannot grant themselves arbitrary memberships
   * because this endpoint is behind @RequireCompanyPermission('memberships.create').
   */
  async addMember(companyId: string, dto: CreateMembershipDto, actorUserId: string) {
    // Verify target user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.user_id },
    });
    if (!user) throw new NotFoundException('Target user not found');

    // Verify company exists (should always be true given guard already validated membership)
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');

    // Detect duplicate membership
    const existing = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: dto.user_id, company_id: companyId },
      },
    });
    if (existing) {
      throw new ConflictException('User already has a membership in this company');
    }

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.companyMembership.create({
        data: {
          user_id: dto.user_id,
          company_id: companyId,
          status: dto.status ?? MembershipStatus.ACTIVE,
        },
        include: {
          user: {
            select: { id: true, email: true, first_name: true, last_name: true },
          },
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.CREATE,
          entityType: 'COMPANY_MEMBERSHIP',
          entityId: membership.id,
          payload: { target_user_id: dto.user_id, status: membership.status },
        },
        tx,
      );

      return membership;
    });
  }

  /**
   * Updates a membership's status (e.g., ACTIVE → INACTIVE for deactivation).
   * Verifies the membership belongs to the authorized company.
   * Does not allow physical deletion.
   */
  async updateMember(
    companyId: string,
    membershipId: string,
    dto: UpdateMembershipDto,
    actorUserId: string,
  ) {
    const membership = await this.prisma.companyMembership.findUnique({
      where: { id: membershipId },
    });

    // 404 if not found or belongs to a different company — prevents cross-company manipulation
    if (!membership || membership.company_id !== companyId) {
      throw new NotFoundException();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.companyMembership.update({
        where: { id: membershipId },
        data: { status: dto.status },
        include: {
          user: { select: { id: true, email: true, first_name: true, last_name: true } },
        },
      });

      await this.auditLogService.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'COMPANY_MEMBERSHIP',
          entityId: membershipId,
          payload: { status: updated.status },
        },
        tx,
      );

      return updated;
    });
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Verifies a company exists and the user has ACTIVE membership.
   * Used by the membership controller to validate URL companyId vs X-Company-ID.
   */
  async assertCompanyAccess(companyId: string, userId: string): Promise<void> {
    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        user_id_company_id: { user_id: userId, company_id: companyId },
      },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException();
    }
  }
}
