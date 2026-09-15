import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { AuditEventType, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { CreateTableDto, UpdateTableDto } from './tables.dto.js';

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }

  /**
   * Tables of the authorized branch. Both ids are guard-verified context:
   * PermissionGuard (branch scope) has already proved the caller holds the
   * permission at X-Branch-ID and that the branch belongs to X-Company-ID.
   */
  async listTables(
    branchId: string,
    page: { limit: number; offset: number },
  ): Promise<Paginated<unknown>> {
    const where = { branch_id: branchId };
    const [data, total] = await Promise.all([
      this.prisma.table.findMany({
        where,
        orderBy: { label: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.table.count({ where }),
    ]);
    return { data, meta: { total, limit: page.limit, offset: page.offset } };
  }

  /** Scoped by id AND branch_id in one query; 404 for anything out of scope. */
  async getTable(tableId: string, branchId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, branch_id: branchId },
    });
    if (!table) throw new NotFoundException();
    return table;
  }

  async createTable(
    branchId: string,
    companyId: string,
    dto: CreateTableDto,
    actorUserId: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const table = await tx.table.create({
          data: {
            branch_id: branchId,
            label: dto.label,
            capacity: dto.capacity,
            zone: dto.zone ?? null,
          },
        });

        await this.auditLogService.create(
          {
            actorUserId,
            companyId,
            branchId,
            eventType: AuditEventType.CREATE,
            entityType: 'TABLE',
            entityId: table.id,
            payload: { label: dto.label, capacity: dto.capacity },
          },
          tx,
        );

        return table;
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          'A table with this label already exists at this branch',
        );
      }
      throw e;
    }
  }

  async updateTable(
    tableId: string,
    branchId: string,
    companyId: string,
    dto: UpdateTableDto,
    actorUserId: string,
  ) {
    await this.getTable(tableId, branchId);

    // A table a seated party is sitting at cannot be taken out of service:
    // the party would hold a table the podium no longer knows about. Release
    // it first (a queue operation), then deactivate.
    if (dto.status === 'INACTIVE') {
      const occupant = await this.prisma.queueToken.findFirst({
        where: { assigned_table_id: tableId, status: 'SEATED' },
        select: { id: true },
      });
      if (occupant) {
        throw new ConflictException('This table is occupied by a seated party; release it before deactivating');
      }
    }

    const data: Prisma.TableUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.zone !== undefined) data.zone = dto.zone;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.table.update({ where: { id: tableId }, data });

        await this.auditLogService.create(
          {
            actorUserId,
            companyId,
            branchId,
            eventType: AuditEventType.UPDATE,
            entityType: 'TABLE',
            entityId: tableId,
            payload: { changed_fields: Object.keys(dto) },
          },
          tx,
        );

        return updated;
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          'A table with this label already exists at this branch',
        );
      }
      throw e;
    }
  }
}
