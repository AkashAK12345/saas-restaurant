import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { AuditEventType, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';
import { normalizePhone } from './customers.phone.js';

const PHONE_INVALID = 'phone must contain 6–15 digits, optionally prefixed with +';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Throws a 400 for an unparseable phone; returns the normalized value. */
  private toStoredPhone(input: string): string {
    const normalized = normalizePhone(input);
    if (!normalized) throw new BadRequestException(PHONE_INVALID);
    return normalized;
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }

  /**
   * Customers of the authorized company. `companyId` is the guard-verified
   * context, never raw client input.
   */
  async listCustomers(
    companyId: string,
    page: { limit: number; offset: number },
  ): Promise<Paginated<unknown>> {
    const where = { company_id: companyId };
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { data, meta: { total, limit: page.limit, offset: page.offset } };
  }

  /**
   * Scoped by id AND company_id in a single query — never fetch-then-check.
   * 404 for any out-of-scope id so cross-company existence is not disclosed.
   */
  async getCustomer(customerId: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!customer) throw new NotFoundException();
    return customer;
  }

  async createCustomer(
    companyId: string,
    dto: CreateCustomerDto,
    actorUserId: string,
  ) {
    const phone = dto.phone !== undefined ? this.toStoredPhone(dto.phone) : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: { company_id: companyId, name: dto.name, phone },
        });

        await this.auditLogService.create(
          {
            actorUserId,
            companyId,
            eventType: AuditEventType.CREATE,
            entityType: 'CUSTOMER',
            entityId: customer.id,
            // Phone deliberately omitted from the audit payload (PII with no
            // forensic value beyond the entity id).
            payload: { name: dto.name, has_phone: phone !== null },
          },
          tx,
        );

        return customer;
      });
    } catch (e) {
      // The unique index is the authority; a pre-check would still race.
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          'A customer with this phone already exists in this company',
        );
      }
      throw e;
    }
  }

  async updateCustomer(
    customerId: string,
    companyId: string,
    dto: UpdateCustomerDto,
    actorUserId: string,
  ) {
    // Scope check first — 404 hides existence for other companies.
    await this.getCustomer(customerId, companyId);

    const data: Prisma.CustomerUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.phone !== undefined) {
      data.phone = dto.phone === null ? null : this.toStoredPhone(dto.phone);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.customer.update({
          where: { id: customerId },
          data,
        });

        await this.auditLogService.create(
          {
            actorUserId,
            companyId,
            eventType: AuditEventType.UPDATE,
            entityType: 'CUSTOMER',
            entityId: customerId,
            payload: { changed_fields: Object.keys(dto) },
          },
          tx,
        );

        return updated;
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          'A customer with this phone already exists in this company',
        );
      }
      throw e;
    }
  }
}
