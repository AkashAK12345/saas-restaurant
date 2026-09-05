import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditEventType, MembershipStatus } from '@samco/database';

export interface CreateAuditLogParams {
  /** The user performing the action. Can be null for platform/unauthenticated events. */
  actorUserId?: string | null;
  /** The company context. Can be null for platform/unauthenticated events. */
  companyId?: string | null;
  /** The branch context. Nullable. */
  branchId?: string | null;
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  payload: any;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends an audit log record securely.
   * If `tx` is provided, the audit log is written within the same transaction.
   * Validates company/branch ownership dynamically.
   */
  async create(
    params: CreateAuditLogParams,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.prisma;

    try {
      // 1. Strict Validation
      if (params.companyId) {
        // If companyId is provided, we expect a valid authenticated actor
        if (!params.actorUserId) {
          throw new Error('Audit constraint: Company-scoped events require an actorUserId');
        }

        const membership = await db.companyMembership.findUnique({
          where: {
            user_id_company_id: {
              user_id: params.actorUserId,
              company_id: params.companyId,
            },
          },
        });
        
        // During Company creation, the actor just joined the company in this tx.
        if (!membership || membership.status !== MembershipStatus.ACTIVE) {
          throw new Error('Audit constraint: Actor is not an ACTIVE member of the company');
        }

        if (params.branchId) {
          const branch = await db.branch.findUnique({
            where: { id: params.branchId },
          });
          if (!branch || branch.company_id !== params.companyId) {
            throw new Error('Audit constraint: Branch does not belong to the company');
          }
        }
      }

      // 2. Sensitive Data Sanitization (Defensive)
      const sanitizedPayload = { ...params.payload };
      const sensitiveKeys = [
        'password',
        'password_hash',
        'token',
        'token_hash',
        'jwt',
        'authorization',
        'cookie',
      ];
      
      const sanitizeObject = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
          if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
            obj[key] = '[REDACTED]';
          } else if (typeof obj[key] === 'object') {
            sanitizeObject(obj[key]);
          }
        }
      };
      
      sanitizeObject(sanitizedPayload);

      // 3. Append to DB
      await db.auditLog.create({
        data: {
          user_id: params.actorUserId,
          company_id: params.companyId,
          branch_id: params.branchId,
          event_type: params.eventType,
          entity_type: params.entityType,
          entity_id: params.entityId,
          payload: sanitizedPayload,
        },
      });
    } catch (error) {
      // For non-transactional calls (e.g. auth failures), log but do not crash the app
      this.logger.error(`Failed to create audit log: ${(error as Error).message}`, (error as Error).stack);
      
      // If we are inside a transaction, bubble up the error to rollback the transaction
      if (tx) {
        throw error;
      }
    }
  }

  /**
   * Retrieves audit logs for a specific company with optional filtering.
   * Guaranteed to isolate by companyId.
   */
  async listLogs(
    companyId: string,
    filters: {
      branchId?: string;
      eventType?: AuditEventType;
      entityType?: string;
      entityId?: string;
      limit: number;
      offset: number;
    },
  ) {
    // Note: The caller (controller) ensures the user is authorized.
    // The query enforces tenant isolation via the WHERE clause.
    
    // Construct dynamic where clause
    const where: any = { company_id: companyId };
    
    if (filters.branchId) {
      where.branch_id = filters.branchId;
    }
    if (filters.eventType) {
      where.event_type = filters.eventType;
    }
    if (filters.entityType) {
      where.entity_type = filters.entityType;
    }
    if (filters.entityId) {
      where.entity_id = filters.entityId;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' }, // newest first
        take: filters.limit,
        skip: filters.offset,
        include: {
          user: {
            select: { id: true, email: true, first_name: true, last_name: true }
          },
          branch: {
            select: { id: true, name: true }
          }
        }
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Format output to remove nulls safely
    return {
      data: items.map(item => ({
        id: item.id,
        created_at: item.created_at,
        event_type: item.event_type,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        payload: item.payload,
        user: item.user ? item.user : null,
        branch: item.branch ? item.branch : null,
      })),
      meta: {
        total,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }
}
