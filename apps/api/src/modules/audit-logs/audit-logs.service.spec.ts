import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalServerErrorException } from '@nestjs/common';
import { AuditEventType } from '@samco/database';
import { AuditLogService, AuditFailurePolicy } from './audit-logs.service.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

/**
 * H3 — audit write failure policy, and L3/L4 — payload sanitization.
 *
 * The failure policy is asserted here rather than end-to-end because forcing a
 * genuine audit-write failure through HTTP would require corrupting the database
 * mid-request. What matters is the decision logic: which failures propagate and
 * which are absorbed, and that nothing is ever absorbed *silently*.
 */

const ACTOR = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const BRANCH = '33333333-3333-4333-8333-333333333333';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    companyMembership: {
      findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
    },
    branch: {
      findUnique: vi.fn().mockResolvedValue({ id: BRANCH, company_id: COMPANY }),
    },
    ...overrides,
  };
}

function baseParams() {
  return {
    actorUserId: ACTOR,
    companyId: COMPANY,
    eventType: AuditEventType.UPDATE,
    entityType: 'THING',
    entityId: 'thing-1',
    payload: { ok: true },
  };
}

describe('AuditLogService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AuditLogService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AuditLogService(prisma as unknown as PrismaService);
    // Silence the intentional error logging in failure-path tests.
    vi.spyOn((service as never as { logger: { error: () => void } }).logger, 'error').mockImplementation(
      () => undefined,
    );
  });

  describe('H3 — failure policy', () => {
    it('writes successfully on the happy path', async () => {
      await expect(service.create(baseParams())).resolves.toBeUndefined();
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('STRICT is the default for non-transactional calls', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      // No failurePolicy given → must NOT silently swallow.
      await expect(service.create(baseParams())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('STRICT propagates a write failure', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.create({ ...baseParams(), failurePolicy: AuditFailurePolicy.STRICT }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('BEST_EFFORT absorbs a write failure but logs it loudly', async () => {
      const logSpy = (service as never as { logger: { error: ReturnType<typeof vi.fn> } })
        .logger.error as ReturnType<typeof vi.fn>;
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.create({
          ...baseParams(),
          companyId: null,
          failurePolicy: AuditFailurePolicy.BEST_EFFORT,
        }),
      ).resolves.toBeUndefined();

      // Absorbed, but never silent.
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(String(logSpy.mock.calls[0][0])).toContain('AUDIT_WRITE_FAILURE');
    });

    it('inside a transaction the raw error propagates so the mutation rolls back', async () => {
      const tx = makePrisma();
      const boom = new Error('constraint violated');
      tx.auditLog.create.mockRejectedValue(boom);

      // The original error is rethrown (not wrapped) so Prisma aborts the tx.
      await expect(service.create(baseParams(), tx as never)).rejects.toBe(boom);
    });

    it('a transactional call ignores BEST_EFFORT — atomicity always wins', async () => {
      const tx = makePrisma();
      const boom = new Error('constraint violated');
      tx.auditLog.create.mockRejectedValue(boom);

      await expect(
        service.create(
          { ...baseParams(), failurePolicy: AuditFailurePolicy.BEST_EFFORT },
          tx as never,
        ),
      ).rejects.toBe(boom);
    });

    it('writes through the transaction client when one is supplied', async () => {
      const tx = makePrisma();
      await service.create(baseParams(), tx as never);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('coherence validation', () => {
    it('rejects a company-scoped event with no actor', async () => {
      await expect(
        service.create({ ...baseParams(), actorUserId: null }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects an actor with no membership in the company', async () => {
      prisma.companyMembership.findUnique.mockResolvedValue(null);
      await expect(service.create(baseParams())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('M2 — accepts an INACTIVE membership so self-deactivation can be audited', async () => {
      // The guard already proved ACTIVE membership at authorization time.
      // Re-asserting ACTIVE here rolled back any operation that deactivated the
      // actor's own membership.
      prisma.companyMembership.findUnique.mockResolvedValue({ status: 'INACTIVE' });
      await expect(service.create(baseParams())).resolves.toBeUndefined();
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a branch that belongs to a different company', async () => {
      prisma.branch.findUnique.mockResolvedValue({
        id: BRANCH,
        company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      await expect(
        service.create({ ...baseParams(), branchId: BRANCH }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('skips company validation entirely for platform events', async () => {
      await expect(
        service.create({
          actorUserId: null,
          companyId: null,
          eventType: AuditEventType.SECURITY,
          entityType: 'AUTHENTICATION',
          entityId: 'unknown',
          payload: { action: 'login_failure' },
          failurePolicy: AuditFailurePolicy.BEST_EFFORT,
        }),
      ).resolves.toBeUndefined();
      expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('L3/L4 — sanitization', () => {
    const storedPayload = () => prisma.auditLog.create.mock.calls[0][0].data.payload;

    it('does not mutate the caller object graph', async () => {
      const payload = {
        password: 'secret',
        nested: { token: 'abc', keep: 1 },
      };
      const snapshot = structuredClone(payload);

      await service.create({ ...baseParams(), payload });

      expect(payload).toEqual(snapshot);
      expect(payload.nested.token).toBe('abc');
    });

    it('redacts sensitive keys recursively, including inside arrays', async () => {
      await service.create({
        ...baseParams(),
        payload: {
          password: 'p',
          nested: { refresh_token: 'r', deeper: { authorization: 'a', keep: 'yes' } },
          items: [{ api_key: 'k' }, { safe: 1 }],
        },
      });

      const p = storedPayload();
      expect(p.password).toBe('[REDACTED]');
      expect(p.nested.refresh_token).toBe('[REDACTED]');
      expect(p.nested.deeper.authorization).toBe('[REDACTED]');
      expect(p.items[0].api_key).toBe('[REDACTED]');
      expect(p.nested.deeper.keep).toBe('yes');
      expect(p.items[1].safe).toBe(1);
    });

    it('redacts session identifiers', async () => {
      await service.create({
        ...baseParams(),
        payload: { session_id: 'abc', sessionToken: 'def' },
      });
      const p = storedPayload();
      expect(p.session_id).toBe('[REDACTED]');
      expect(p.sessionToken).toBe('[REDACTED]');
    });

    it('keeps a queue token_number, which is a public ticket and not a secret', async () => {
      await service.create({
        ...baseParams(),
        payload: { token_number: 7, access_token: 'a', nested: { token: 'b' } },
      });
      const p = storedPayload();
      expect(p.token_number).toBe(7);
      expect(p.access_token).toBe('[REDACTED]');
      expect(p.nested.token).toBe('[REDACTED]');
    });

    it('matches key fragments case-insensitively', async () => {
      await service.create({
        ...baseParams(),
        payload: { PassWord: 'x', AUTHORIZATION: 'y', Refresh_Token: 'z' },
      });
      const p = storedPayload();
      expect(Object.values(p)).toEqual(['[REDACTED]', '[REDACTED]', '[REDACTED]']);
    });

    it('preserves useful non-sensitive forensic data', async () => {
      await service.create({
        ...baseParams(),
        payload: { changed_fields: ['name', 'status'], target_user_id: ACTOR },
      });
      const p = storedPayload();
      expect(p.changed_fields).toEqual(['name', 'status']);
      expect(p.target_user_id).toBe(ACTOR);
    });

    it('survives a circular payload instead of hanging', async () => {
      const payload: Record<string, unknown> = { a: 1 };
      payload.self = payload;

      await expect(
        service.create({ ...baseParams(), payload }),
      ).resolves.toBeUndefined();
      expect(storedPayload().self).toBe('[CIRCULAR]');
    });

    it('passes primitives and dates through safely', async () => {
      const when = new Date('2026-01-01T00:00:00.000Z');
      await service.create({
        ...baseParams(),
        payload: { n: 1, s: 'x', b: true, nul: null, when },
      });
      const p = storedPayload();
      expect(p).toEqual({
        n: 1,
        s: 'x',
        b: true,
        nul: null,
        when: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('H2 — listLogs scoping', () => {
    function listPrisma() {
      return {
        auditLog: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
      };
    }

    it('always pins company_id in the where clause', async () => {
      const p = listPrisma();
      const s = new AuditLogService(p as unknown as PrismaService);
      await s.listLogs(COMPANY, { limit: 10, offset: 0 });

      const where = p.auditLog.findMany.mock.calls[0][0].where;
      expect(where.company_id).toBe(COMPANY);
    });

    it('applies each supplied filter under the pinned company scope', async () => {
      const p = listPrisma();
      const s = new AuditLogService(p as unknown as PrismaService);
      await s.listLogs(COMPANY, {
        branch_id: BRANCH,
        user_id: ACTOR,
        entity_type: 'BRANCH',
        entity_id: 'e1',
        event_type: AuditEventType.CREATE,
        limit: 10,
        offset: 0,
      });

      const where = p.auditLog.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        company_id: COMPANY,
        branch_id: BRANCH,
        user_id: ACTOR,
        entity_type: 'BRANCH',
        entity_id: 'e1',
        event_type: AuditEventType.CREATE,
      });
    });

    it('builds a created_at range from from/to', async () => {
      const p = listPrisma();
      const s = new AuditLogService(p as unknown as PrismaService);
      const from = new Date('2026-01-01');
      const to = new Date('2026-02-01');
      await s.listLogs(COMPANY, { from, to, limit: 10, offset: 0 });

      const where = p.auditLog.findMany.mock.calls[0][0].where;
      expect(where.created_at).toEqual({ gte: from, lte: to });
    });

    it('counts with the same where clause so total is filter-aware', async () => {
      const p = listPrisma();
      const s = new AuditLogService(p as unknown as PrismaService);
      await s.listLogs(COMPANY, { entity_type: 'BRANCH', limit: 10, offset: 0 });

      expect(p.auditLog.count.mock.calls[0][0].where).toEqual(
        p.auditLog.findMany.mock.calls[0][0].where,
      );
    });
  });
});
