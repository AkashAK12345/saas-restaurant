import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';
import type { AuthorizationService } from './authorization.service.js';
import type { PermissionMeta } from './require-permission.decorator.js';

/**
 * Unit tests for PermissionGuard.
 *
 * These pin the guard's contract: which context headers are required, which
 * AuthorizationService call each scope delegates to, and — critically — that the
 * guard passes the HEADER-supplied company/branch to the authorization service
 * rather than trusting them as proof on their own.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';

function makeContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let authorization: {
    hasCompanyPermission: ReturnType<typeof vi.fn>;
    hasBranchPermission: ReturnType<typeof vi.fn>;
    hasCompanyStatusPermission: ReturnType<typeof vi.fn>;
  };
  let guard: PermissionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() };
    authorization = {
      hasCompanyPermission: vi.fn().mockResolvedValue(true),
      hasBranchPermission: vi.fn().mockResolvedValue(true),
      hasCompanyStatusPermission: vi.fn().mockResolvedValue(true),
    };
    guard = new PermissionGuard(
      reflector as unknown as Reflector,
      authorization as unknown as AuthorizationService,
    );
  });

  function setMeta(meta: PermissionMeta | undefined) {
    reflector.getAllAndOverride.mockReturnValue(meta);
  }

  it('passes through when the route declares no permission metadata', async () => {
    setMeta(undefined);
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.hasCompanyPermission).not.toHaveBeenCalled();
    expect(authorization.hasBranchPermission).not.toHaveBeenCalled();
  });

  it('throws Unauthorized when no authenticated user is attached', async () => {
    setMeta({ permission: 'users.view', scope: 'company' });
    const ctx = makeContext({ headers: { 'x-company-id': COMPANY_ID } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('company scope', () => {
    beforeEach(() => setMeta({ permission: 'users.view', scope: 'company' }));

    it('requires X-Company-ID', async () => {
      const ctx = makeContext({ user: { id: USER_ID }, headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      expect(authorization.hasCompanyPermission).not.toHaveBeenCalled();
    });

    it('delegates to hasCompanyPermission with the header company id', async () => {
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(authorization.hasCompanyPermission).toHaveBeenCalledWith(
        USER_ID,
        COMPANY_ID,
        'users.view',
      );
    });

    it('throws Forbidden when the service denies', async () => {
      authorization.hasCompanyPermission.mockResolvedValue(false);
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not require a branch header', async () => {
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('branch scope', () => {
    beforeEach(() => setMeta({ permission: 'users.update', scope: 'branch' }));

    it('requires X-Company-ID', async () => {
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-branch-id': BRANCH_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires X-Branch-ID', async () => {
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      expect(authorization.hasBranchPermission).not.toHaveBeenCalled();
    });

    it('delegates to hasBranchPermission with both header ids', async () => {
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID, 'x-branch-id': BRANCH_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(authorization.hasBranchPermission).toHaveBeenCalledWith(
        USER_ID,
        COMPANY_ID,
        BRANCH_ID,
        'users.update',
      );
      // Branch scope must never fall back to the weaker company-wide check.
      expect(authorization.hasCompanyPermission).not.toHaveBeenCalled();
    });

    it('throws Forbidden when the service denies', async () => {
      authorization.hasBranchPermission.mockResolvedValue(false);
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID, 'x-branch-id': BRANCH_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });


  describe('company_status scope', () => {
    beforeEach(() =>
      setMeta({ permission: 'companies.disable', scope: 'company_status' }),
    );

    it('requires X-Company-ID', async () => {
      const ctx = makeContext({ user: { id: USER_ID }, headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      expect(authorization.hasCompanyStatusPermission).not.toHaveBeenCalled();
    });

    it('delegates to hasCompanyStatusPermission, not the ordinary company check', async () => {
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(authorization.hasCompanyStatusPermission).toHaveBeenCalledWith(
        USER_ID,
        COMPANY_ID,
        'companies.disable',
      );
      // Must not silently fall through to the status-gated company check.
      expect(authorization.hasCompanyPermission).not.toHaveBeenCalled();
      expect(authorization.hasBranchPermission).not.toHaveBeenCalled();
    });

    it('throws Forbidden when the service denies', async () => {
      authorization.hasCompanyStatusPermission.mockResolvedValue(false);
      const ctx = makeContext({
        user: { id: USER_ID },
        headers: { 'x-company-id': COMPANY_ID },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires authentication like every other scope', async () => {
      const ctx = makeContext({ headers: { 'x-company-id': COMPANY_ID } });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('treats context headers as claims to be verified, never as proof', async () => {
    // Headers alone must not authorize: when the service says no, the guard
    // rejects regardless of how well-formed the supplied context is.
    setMeta({ permission: 'users.view', scope: 'company' });
    authorization.hasCompanyPermission.mockResolvedValue(false);
    const ctx = makeContext({
      user: { id: USER_ID },
      headers: { 'x-company-id': COMPANY_ID, 'x-branch-id': BRANCH_ID },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ignores an is_superadmin flag on the request user', async () => {
    setMeta({ permission: 'users.view', scope: 'company' });
    authorization.hasCompanyPermission.mockResolvedValue(false);
    const ctx = makeContext({
      user: { id: USER_ID, is_superadmin: true },
      headers: { 'x-company-id': COMPANY_ID },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
