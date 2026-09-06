import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { DisplayDeviceGuard } from './display-device.guard.js';
import type { DisplayDeviceAuthService } from './display-device-auth.service.js';

const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const DISPLAY = {
  id: '11111111-1111-4111-8111-111111111111',
  branchId: BRANCH_ID,
  companyId: '44444444-4444-4444-8444-444444444444',
  kind: 'QUEUE_CUSTOMER',
};

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('DisplayDeviceGuard', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let auth: { authenticate: ReturnType<typeof vi.fn> };
  let guard: DisplayDeviceGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    auth = { authenticate: vi.fn().mockResolvedValue(DISPLAY) };
    guard = new DisplayDeviceGuard(
      reflector as unknown as Reflector,
      auth as unknown as DisplayDeviceAuthService,
    );
  });

  it('passes the Display-scheme credential and X-Branch-ID to the auth service', async () => {
    const req = { headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(auth.authenticate).toHaveBeenCalledWith('dev.secret', BRANCH_ID);
    expect(req).toHaveProperty('display', DISPLAY);
  });

  it('accepts the scheme case-insensitively', async () => {
    const req = { headers: { authorization: 'display dev.secret', 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it('does NOT accept a Bearer (staff JWT) scheme — separate trust path', async () => {
    // Real service behaviour: no credential → null. The guard must never hand
    // a Bearer value through as if it were a display credential.
    auth.authenticate.mockImplementation(async (cred: string | undefined) =>
      cred === undefined ? null : DISPLAY,
    );
    const req = { headers: { authorization: 'Bearer some.jwt.token', 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // The JWT text itself never reaches the display authenticator.
    expect(auth.authenticate).toHaveBeenCalledWith(undefined, BRANCH_ID);
  });

  it('rejects a missing Authorization header with 401', async () => {
    auth.authenticate.mockResolvedValue(null);
    const req = { headers: { 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the auth service returns null, with a generic 401', async () => {
    auth.authenticate.mockResolvedValue(null);
    const req = { headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID } };
    const err = await guard.canActivate(makeContext(req)).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid display credential');
  });

  it('allows any kind when the route declares no @RequireDisplayKind', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const req = { headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it('allows a listed kind', async () => {
    reflector.getAllAndOverride.mockReturnValue(['QUEUE_CUSTOMER', 'QUEUE_ADMIN']);
    const req = { headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it('rejects an unlisted kind with 403 — authenticated but wrong screen', async () => {
    reflector.getAllAndOverride.mockReturnValue(['BANQUET_CHEF']);
    const req = { headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks kind only AFTER authentication succeeds', async () => {
    reflector.getAllAndOverride.mockReturnValue(['BANQUET_CHEF']);
    auth.authenticate.mockResolvedValue(null);
    const req = { headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID } };
    // Unauthenticated wins over wrong-kind: nothing is disclosed to an
    // unauthenticated caller about what kinds a route accepts.
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('never consults user, roles or permissions', async () => {
    const req = {
      user: { id: 'staff', is_superadmin: true },
      headers: { authorization: 'Display dev.secret', 'x-branch-id': BRANCH_ID },
    };
    auth.authenticate.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
