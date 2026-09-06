import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditEventType, Prisma } from '@samco/database';

/**
 * What should happen when the audit record itself cannot be written.
 *
 * STRICT       — propagate. Used whenever the audit record is part of the
 *                security story of the operation: every business mutation
 *                (which always runs inside a transaction, so the mutation rolls
 *                back with it) and every event that ISSUES or REVOKES access.
 *                If we cannot record that a session was created, we do not
 *                create the session.
 *
 * BEST_EFFORT  — log loudly at error level with a distinctive marker and carry
 *                on. Reserved for events where the operation is already denying
 *                access and throwing would convert a clean 401 into a 500 (which
 *                is both a worse signal and a probing surface). The failure is
 *                never silent — it is an ERROR log with AUDIT_WRITE_FAILURE.
 *
 * There is no implicit default: every non-transactional call site must state its
 * policy, so no future call can accidentally inherit silent-swallow behaviour.
 */
export enum AuditFailurePolicy {
  STRICT = 'STRICT',
  BEST_EFFORT = 'BEST_EFFORT',
}

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
  payload: unknown;
  /**
   * Required for calls made outside a transaction. Ignored when `tx` is given —
   * transactional writes are always STRICT so the mutation and its audit record
   * succeed or fail together.
   */
  failurePolicy?: AuditFailurePolicy;
}

export interface AuditLogFilters {
  branch_id?: string;
  user_id?: string;
  event_type?: AuditEventType;
  entity_type?: string;
  entity_id?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

// Substring matches against payload keys, case-insensitive. Anything matching is
// replaced wholesale — the value is never inspected or partially preserved.
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'token',
  'secret',
  'jwt',
  'authorization',
  'cookie',
  'credential',
  'session',
  'refresh',
  'api_key',
  'apikey',
  'salt',
  'hash',
];

const REDACTED = '[REDACTED]';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recursively produce a sanitized DEEP COPY of the payload.
   *
   * The caller's object graph is never mutated — the previous implementation
   * shallow-copied the root and then mutated nested objects in place, which
   * silently rewrote DTOs still held by the calling service.
   *
   * Cycles are tolerated via a seen-set so a self-referencing payload cannot
   * hang the request.
   */
  private sanitizePayload(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || typeof value !== 'object') return value;

    if (value instanceof Date) return value.toISOString();

    if (seen.has(value as object)) return '[CIRCULAR]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizePayload(item, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (SENSITIVE_KEY_FRAGMENTS.some((frag) => lowered.includes(frag))) {
        out[key] = REDACTED;
      } else {
        out[key] = this.sanitizePayload(val, seen);
      }
    }
    return out;
  }

  /**
   * Appends an audit log record.
   *
   * If `tx` is provided the record is written inside that transaction, so the
   * business mutation and its audit trail commit or roll back together.
   *
   * Validates company/branch coherence before writing.
   */
  async create(
    params: CreateAuditLogParams,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = (tx ?? this.prisma) as Prisma.TransactionClient;
    const policy = tx
      ? AuditFailurePolicy.STRICT
      : (params.failurePolicy ?? AuditFailurePolicy.STRICT);

    try {
      // 1. Coherence validation
      if (params.companyId) {
        if (!params.actorUserId) {
          throw new Error('Audit constraint: Company-scoped events require an actorUserId');
        }

        // The actor must belong to the company the event is attributed to.
        //
        // Existence only — NOT status. PermissionGuard already proved the actor
        // held ACTIVE membership when the request was authorized. Re-asserting
        // ACTIVE here inside the transaction broke any operation that legitimately
        // deactivates the actor's own membership: the row was already INACTIVE by
        // the time the audit ran, so the whole mutation rolled back with a 500.
        const membership = await db.companyMembership.findUnique({
          where: {
            user_id_company_id: {
              user_id: params.actorUserId,
              company_id: params.companyId,
            },
          },
        });

        if (!membership) {
          throw new Error('Audit constraint: Actor has no membership in the company');
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

      // 2. Sanitization (deep copy — caller objects untouched)
      const sanitizedPayload = this.sanitizePayload(params.payload);

      // 3. Append
      await db.auditLog.create({
        data: {
          user_id: params.actorUserId ?? null,
          company_id: params.companyId ?? null,
          branch_id: params.branchId ?? null,
          event_type: params.eventType,
          entity_type: params.entityType,
          entity_id: params.entityId,
          payload: sanitizedPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const message = (error as Error).message;

      this.logger.error(
        `AUDIT_WRITE_FAILURE event=${params.eventType} entity=${params.entityType}:${params.entityId} policy=${policy}: ${message}`,
        (error as Error).stack,
      );

      if (policy === AuditFailurePolicy.STRICT) {
        // Inside a transaction this rolls the mutation back. Outside one it
        // fails the request rather than issuing access with no audit trail.
        if (tx) throw error;
        throw new InternalServerErrorException('Unable to record audit event');
      }
      // BEST_EFFORT: already logged as an ERROR above — never silent.
    }
  }

  /**
   * Retrieves audit logs for a company.
   *
   * company_id is always pinned in the WHERE clause and can never be supplied or
   * overridden by the caller's filters, so no combination of query parameters can
   * return another company's records.
   */
  async listLogs(companyId: string, filters: AuditLogFilters) {
    const where: Prisma.AuditLogWhereInput = { company_id: companyId };

    if (filters.branch_id) where.branch_id = filters.branch_id;
    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.event_type) where.event_type = filters.event_type;
    if (filters.entity_type) where.entity_type = filters.entity_type;
    if (filters.entity_id) where.entity_id = filters.entity_id;

    if (filters.from || filters.to) {
      where.created_at = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' }, // newest first
        take: filters.limit,
        skip: filters.offset,
        include: {
          user: {
            select: { id: true, email: true, first_name: true, last_name: true },
          },
          branch: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: items.map((item) => ({
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
