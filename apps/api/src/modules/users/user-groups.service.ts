import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditEventType, MembershipStatus, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { SaveUserGroupDto } from './user-groups.dto.js';

export interface UserGroupView {
  id: string;
  name: string;
  members: { id: string; name: string; email: string }[];
}

const displayName = (u: { email: string; first_name: string | null; last_name: string | null }) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email.split('@')[0];

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * User groups — named lists of a company's members ("Branch Heads",
 * "Kitchen"), kept on User Management.
 *
 * A group grants nothing: access is each member's own. Groups exist so a
 * set of people can be picked at once. Only ACTIVE members of the company
 * can be in one, and a member who leaves drops out of every list here.
 */
@Injectable()
export class UserGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(companyId: string): Promise<UserGroupView[]> {
    const groups = await this.prisma.userGroup.findMany({
      where: { company_id: companyId },
      include: this.membersInclude(companyId),
    });
    return groups.map((g) => this.view(g)).sort(byName);
  }

  async create(companyId: string, actorUserId: string, dto: SaveUserGroupDto): Promise<UserGroupView> {
    const memberIds = await this.checkMembers(companyId, dto.member_ids);
    await this.checkNameFree(companyId, dto.name);
    const id = await this.write(async (tx) => {
      const group = await tx.userGroup.create({
        data: {
          company_id: companyId,
          name: dto.name,
          members: { create: memberIds.map((user_id) => ({ user_id })) },
        },
      });
      await this.audit.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.CREATE,
          entityType: 'USER_GROUP',
          entityId: group.id,
          payload: { name: dto.name, member_ids: memberIds },
        },
        tx,
      );
      return group.id;
    });
    return this.get(companyId, id);
  }

  async save(companyId: string, actorUserId: string, id: string, dto: SaveUserGroupDto): Promise<UserGroupView> {
    const existing = await this.find(companyId, id);
    const memberIds = await this.checkMembers(companyId, dto.member_ids);
    await this.checkNameFree(companyId, dto.name, id);
    await this.write(async (tx) => {
      await tx.userGroup.update({ where: { id }, data: { name: dto.name } });
      // Only this company's active members are listed and replaced; anyone
      // who has since left stays recorded rather than being rewritten.
      await tx.userGroupMember.deleteMany({
        where: { group_id: id, user: { memberships: { some: { company_id: companyId, status: MembershipStatus.ACTIVE } } } },
      });
      await tx.userGroupMember.createMany({
        data: memberIds.map((user_id) => ({ group_id: id, user_id })),
        skipDuplicates: true,
      });
      await this.audit.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.UPDATE,
          entityType: 'USER_GROUP',
          entityId: id,
          payload: { name: dto.name, previous_name: existing.name, member_ids: memberIds },
        },
        tx,
      );
    });
    return this.get(companyId, id);
  }

  async remove(companyId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.find(companyId, id);
    await this.write(async (tx) => {
      await tx.userGroup.delete({ where: { id } });
      await this.audit.create(
        {
          actorUserId,
          companyId,
          eventType: AuditEventType.DELETE,
          entityType: 'USER_GROUP',
          entityId: id,
          payload: { name: existing.name },
        },
        tx,
      );
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private membersInclude(companyId: string) {
    return {
      members: {
        where: { user: { memberships: { some: { company_id: companyId, status: MembershipStatus.ACTIVE } } } },
        include: { user: { select: { id: true, email: true, first_name: true, last_name: true } } },
      },
    } satisfies Prisma.UserGroupInclude;
  }

  private view(group: {
    id: string;
    name: string;
    members: { user: { id: string; email: string; first_name: string | null; last_name: string | null } }[];
  }): UserGroupView {
    return {
      id: group.id,
      name: group.name,
      members: group.members
        .map((m) => ({ id: m.user.id, name: displayName(m.user), email: m.user.email }))
        .sort(byName),
    };
  }

  private async get(companyId: string, id: string) {
    const group = await this.prisma.userGroup.findFirst({
      where: { id, company_id: companyId },
      include: this.membersInclude(companyId),
    });
    if (!group) throw new NotFoundException();
    return this.view(group);
  }

  private async find(companyId: string, id: string) {
    const group = await this.prisma.userGroup.findFirst({ where: { id, company_id: companyId } });
    if (!group) throw new NotFoundException();
    return group;
  }

  /** Every id must be an ACTIVE member of this company. */
  private async checkMembers(companyId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return unique;
    const found = await this.prisma.companyMembership.count({
      where: { company_id: companyId, status: MembershipStatus.ACTIVE, user_id: { in: unique } },
    });
    if (found !== unique.length) throw new UnprocessableEntityException('Every member must be an active user of this company');
    return unique;
  }

  /** Names are unique per company regardless of case: "Kitchen" and "kitchen" are one group. */
  private async checkNameFree(companyId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.userGroup.findFirst({
      where: { company_id: companyId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A group with this name already exists');
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      // Two people naming a group at once: the unique index decides.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A group with this name already exists');
      }
      throw e;
    }
  }
}
