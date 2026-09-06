import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnauthorizedException,
  HttpException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

// bcrypt's real implementation is irrelevant here and slow; we assert HOW it is
// called. Must be declared before importing the service under test.
vi.mock('bcrypt', () => ({
  compare: vi.fn(async () => false),
  hash: vi.fn(async () => 'hashed'),
}));

import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';

/**
 * Unit tests for the parts of AuthService that cannot be asserted end-to-end:
 * specifically the L2 constant-work login path, where the point is not the
 * response (identical either way — that is covered in the e2e suite) but the
 * fact that a bcrypt comparison happens even when no user exists.
 */

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  password_hash: '$2b$10$realhashvalue',
  first_name: 'A',
  last_name: 'B',
  is_superadmin: false,
  status: 'ACTIVE',
};

const DISABLED_USER = { ...USER, status: 'INACTIVE' };

function build() {
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    userSession: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
    auditLog: { create: vi.fn() },
    companyMembership: { findUnique: vi.fn() },
  };
  const jwtService = { sign: vi.fn(() => 'signed.jwt.token') };
  const configService = { get: vi.fn((_k: string, d?: string) => d ?? '7') };
  const auditLogService = { create: vi.fn() };
  const throttle = {
    isBlocked: vi.fn(() => false),
    retryAfterSeconds: vi.fn(() => 900),
    registerFailure: vi.fn(),
    registerSuccess: vi.fn(),
  };

  const service = new AuthService(
    prisma as never,
    jwtService as never,
    configService as never,
    auditLogService as never,
    throttle as never,
  );

  return { service, prisma, jwtService, auditLogService, throttle };
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.mocked(bcrypt.compare).mockClear();
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
  });

  describe('L2 — constant-work login path', () => {
    it('still performs a bcrypt comparison when no user matches', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'pw' }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // The whole point of the fix: the expensive path is not skipped, so the
      // response time does not distinguish "no such user" from "wrong password".
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('compares against a bcrypt-shaped dummy hash, never a real credential', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'pw' }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const [, hashArg] = vi.mocked(bcrypt.compare).mock.calls[0];
      expect(typeof hashArg).toBe('string');
      expect(hashArg).toMatch(/^\$2[aby]\$/);
    });

    it('compares against the real hash when the user does exist', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(USER);

      await expect(
        service.login({ email: USER.email, password: 'wrong' }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const [, hashArg] = vi.mocked(bcrypt.compare).mock.calls[0];
      expect(hashArg).toBe(USER.password_hash);
    });

    it('produces the same exception type for both failure modes', async () => {
      const { service, prisma } = build();

      prisma.user.findUnique.mockResolvedValue(null);
      const missing = await service
        .login({ email: 'ghost@example.com', password: 'pw' }, '127.0.0.1')
        .catch((e) => e);

      prisma.user.findUnique.mockResolvedValue(USER);
      const wrongPw = await service
        .login({ email: USER.email, password: 'pw' }, '127.0.0.1')
        .catch((e) => e);

      expect(missing).toBeInstanceOf(UnauthorizedException);
      expect(wrongPw).toBeInstanceOf(UnauthorizedException);
      expect(missing.message).toBe(wrongPw.message);
    });

    it('normalises the email before lookup', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await service
        .login({ email: '  MiXeD@Example.COM  ', password: 'pw' }, '127.0.0.1')
        .catch(() => undefined);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'mixed@example.com' },
      });
    });
  });


  describe('global user status', () => {
    it('refuses to authenticate a globally disabled account', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(DISABLED_USER);
      // Correct password — only the account status blocks this.
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(
        service.login({ email: USER.email, password: 'right' }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('gives a disabled account the same error as a wrong password', async () => {
      const { service, prisma } = build();

      prisma.user.findUnique.mockResolvedValue(DISABLED_USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      const disabled = await service
        .login({ email: USER.email, password: 'right' }, '127.0.0.1')
        .catch((e) => e);

      prisma.user.findUnique.mockResolvedValue(USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      const wrongPw = await service
        .login({ email: USER.email, password: 'wrong' }, '127.0.0.1')
        .catch((e) => e);

      expect(disabled.message).toBe(wrongPw.message);
      expect(disabled.constructor).toBe(wrongPw.constructor);
    });

    it('counts a disabled-account attempt against the throttle like any failure', async () => {
      const { service, prisma, throttle } = build();
      prisma.user.findUnique.mockResolvedValue(DISABLED_USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await service
        .login({ email: USER.email, password: 'right' }, '9.9.9.9')
        .catch(() => undefined);

      expect(throttle.registerFailure).toHaveBeenCalledWith('9.9.9.9', USER.email);
      expect(throttle.registerSuccess).not.toHaveBeenCalled();
    });

    it('records the real cause in the audit even though the response is generic', async () => {
      const { service, prisma, auditLogService } = build();
      prisma.user.findUnique.mockResolvedValue(DISABLED_USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await service
        .login({ email: USER.email, password: 'right' }, '127.0.0.1')
        .catch(() => undefined);

      // The audit table is server-side and access-controlled, so it may be
      // precise where the HTTP response must not be.
      const [params] = auditLogService.create.mock.calls[0];
      expect(params.payload.reason).toBe('account_disabled');
    });
  });

  describe('M6 — throttle integration', () => {
    it('rejects with 429 before touching the database when blocked', async () => {
      const { service, prisma, throttle } = build();
      throttle.isBlocked.mockReturnValue(true);

      const err = await service
        .login({ email: USER.email, password: 'pw' }, '127.0.0.1')
        .catch((e) => e);

      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      // No user enumeration is even possible: the lookup never happens.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('records a failure for an unknown account, exactly as for a known one', async () => {
      const { service, prisma, throttle } = build();

      prisma.user.findUnique.mockResolvedValue(null);
      await service.login({ email: 'ghost@x.com', password: 'pw' }, '1.2.3.4').catch(() => undefined);

      prisma.user.findUnique.mockResolvedValue(USER);
      await service.login({ email: USER.email, password: 'pw' }, '1.2.3.4').catch(() => undefined);

      expect(throttle.registerFailure).toHaveBeenCalledTimes(2);
      expect(throttle.registerFailure).toHaveBeenNthCalledWith(1, '1.2.3.4', 'ghost@x.com');
      expect(throttle.registerFailure).toHaveBeenNthCalledWith(2, '1.2.3.4', USER.email);
    });

    it('clears the identity budget on a successful login', async () => {
      const { service, prisma, throttle } = build();
      prisma.user.findUnique.mockResolvedValue(USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      prisma.userSession.create.mockResolvedValue({ id: 'session-id' });

      await service.login({ email: USER.email, password: 'right' }, '1.2.3.4');

      expect(throttle.registerSuccess).toHaveBeenCalledWith('1.2.3.4', USER.email);
      expect(throttle.registerFailure).not.toHaveBeenCalled();
    });
  });


  describe('changePassword', () => {
    function buildForChange() {
      const ctx = build();
      ctx.prisma.user.findUnique.mockResolvedValue(USER);
      ctx.prisma.user.update.mockResolvedValue({ ...USER, password_hash: 'new-hash' });
      ctx.prisma.userSession.updateMany.mockResolvedValue({ count: 2 });
      return ctx;
    }

    const DTO = { current_password: 'current', new_password: 'BrandNew123!' };

    it('revokes ONLY the sessions other than the calling one', async () => {
      const { service, prisma } = buildForChange();
      // current password matches, new password differs
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      await service.changePassword(USER.id, 'session-current', DTO);

      const where = prisma.userSession.updateMany.mock.calls[0][0].where;
      expect(where.user_id).toBe(USER.id);
      // The crux of the session policy: everything except the caller's session.
      expect(where.id).toEqual({ not: 'session-current' });
      expect(where.revoked_at).toBeNull();
    });

    it('updates the hash, revokes and audits inside ONE transaction', async () => {
      const { service, prisma, auditLogService } = buildForChange();
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      await service.changePassword(USER.id, 'session-current', DTO);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // The audit call receives the tx client, which makes it STRICT: a failed
      // audit write rolls the password change back.
      expect(auditLogService.create).toHaveBeenCalledTimes(1);
      expect(auditLogService.create.mock.calls[0][1]).toBeDefined();
    });

    it('stores a hash, never the plaintext', async () => {
      const { service, prisma } = buildForChange();
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      await service.changePassword(USER.id, 'session-current', DTO);

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.password_hash).toBe('hashed'); // from the bcrypt mock
      expect(data.password_hash).not.toBe(DTO.new_password);
      expect(JSON.stringify(data)).not.toContain(DTO.new_password);
    });

    it('writes an audit payload free of credential material', async () => {
      const { service, auditLogService } = buildForChange();
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      await service.changePassword(USER.id, 'session-current', DTO);

      const [params] = auditLogService.create.mock.calls[0];
      expect(params.payload.action).toBe('password_changed');
      expect(params.payload.revoked_other_logins).toBe(2);

      const raw = JSON.stringify(params.payload);
      expect(raw).not.toContain(DTO.new_password);
      expect(raw).not.toContain(DTO.current_password);
      expect(raw).not.toContain(USER.password_hash);
      // No session identifier — not even the caller's own.
      expect(raw).not.toContain('session-current');
    });

    it('rejects a wrong current password without touching anything', async () => {
      const { service, prisma } = buildForChange();
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        service.changePassword(USER.id, 'session-current', DTO),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a new password identical to the current one', async () => {
      const { service, prisma } = buildForChange();
      // current matches AND new password also matches the stored hash
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(
        service.changePassword(USER.id, 'session-current', DTO),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('checks sameness against the STORED HASH, not the submitted string', async () => {
      const { service } = buildForChange();
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      await service.changePassword(USER.id, 'session-current', DTO);

      // Second comparison is new_password against the user's real hash, so the
      // check cannot be defeated by sending an inconsistent current_password.
      const calls = vi.mocked(bcrypt.compare).mock.calls;
      expect(calls[1][0]).toBe(DTO.new_password);
      expect(calls[1][1]).toBe(USER.password_hash);
    });

    it('refuses to act on a globally disabled account', async () => {
      const { service, prisma } = buildForChange();
      prisma.user.findUnique.mockResolvedValue(DISABLED_USER);

      await expect(
        service.changePassword(USER.id, 'session-current', DTO),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('operates on the id it is given — there is no body-supplied target', async () => {
      const { service, prisma } = buildForChange();
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);

      await service.changePassword(USER.id, 'session-current', DTO);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: USER.id } });
      expect(prisma.user.update.mock.calls[0][0].where).toEqual({ id: USER.id });
    });
  });

  describe('M1 — session binding', () => {
    it('signs the access token with the issuing session id', async () => {
      const { service, prisma, jwtService } = build();
      prisma.user.findUnique.mockResolvedValue(USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      prisma.userSession.create.mockResolvedValue({ id: 'session-abc' });

      await service.login({ email: USER.email, password: 'right' }, '127.0.0.1');

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: USER.id,
        sid: 'session-abc',
      });
    });

    it('creates the session and its audit record in one transaction', async () => {
      const { service, prisma, auditLogService } = build();
      prisma.user.findUnique.mockResolvedValue(USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      prisma.userSession.create.mockResolvedValue({ id: 'session-abc' });

      await service.login({ email: USER.email, password: 'right' }, '127.0.0.1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // The audit call receives the transaction client as its second argument,
      // which is what makes the write STRICT and atomic with the session.
      expect(auditLogService.create).toHaveBeenCalledTimes(1);
      expect(auditLogService.create.mock.calls[0][1]).toBeDefined();
    });

    it('H3 — no session is issued if its audit record cannot be written', async () => {
      const { service, prisma, auditLogService } = build();
      prisma.user.findUnique.mockResolvedValue(USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      prisma.userSession.create.mockResolvedValue({ id: 'session-abc' });
      auditLogService.create.mockRejectedValue(new Error('audit write failed'));

      // STRICT + transactional: the failure propagates, so the surrounding
      // transaction aborts and no credential ever reaches the caller.
      await expect(
        service.login({ email: USER.email, password: 'right' }, '127.0.0.1'),
      ).rejects.toThrow('audit write failed');
    });

    it('H3 — the failed-login audit is explicitly BEST_EFFORT', async () => {
      const { service, prisma, auditLogService } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await service
        .login({ email: 'ghost@example.com', password: 'pw' }, '127.0.0.1')
        .catch(() => undefined);

      // The request is already being denied, so an audit problem must not turn a
      // clean 401 into a 500 (itself a probing signal). Absorption is asserted in
      // audit-logs.service.spec.ts; what matters here is that this call site
      // opts into it deliberately, and outside any transaction.
      const [params, tx] = auditLogService.create.mock.calls[0];
      expect(params.failurePolicy).toBe('BEST_EFFORT');
      expect(tx).toBeUndefined();
    });

    it('never returns credential material in the login response', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      prisma.userSession.create.mockResolvedValue({ id: 'session-abc' });

      const result = await service.login(
        { email: USER.email, password: 'right' },
        '127.0.0.1',
      );

      expect(result.user).not.toHaveProperty('password_hash');
      expect(JSON.stringify(result)).not.toContain(USER.password_hash);
    });
  });
});
