import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import type { PrismaService } from '../../core/database/prisma.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function makeContext(request: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    findUnique = vi.fn();
    guard = new PlatformAdminGuard({ user: { findUnique } } as unknown as PrismaService);
  });

  it('refuses a request with no authenticated user', async () => {
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses an ordinary active user', async () => {
    findUnique.mockResolvedValue({ is_superadmin: false, status: 'ACTIVE' });
    await expect(guard.canActivate(makeContext({ user: { id: USER_ID }, headers: {} }))).rejects.toThrow(ForbiddenException);
  });

  it('refuses a platform administrator whose account is not ACTIVE', async () => {
    findUnique.mockResolvedValue({ is_superadmin: true, status: 'INACTIVE' });
    await expect(guard.canActivate(makeContext({ user: { id: USER_ID }, headers: {} }))).rejects.toThrow(ForbiddenException);
  });

  it('refuses a user that no longer exists', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext({ user: { id: USER_ID }, headers: {} }))).rejects.toThrow(ForbiddenException);
  });

  it('reads the flag from the database, never from the request user', async () => {
    findUnique.mockResolvedValue({ is_superadmin: false, status: 'ACTIVE' });
    const ctx = makeContext({
      user: { id: USER_ID, is_superadmin: true },
      headers: { 'x-company-id': COMPANY_ID },
      body: { is_superadmin: true },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { is_superadmin: true, status: true },
    });
  });

  it('admits an ACTIVE platform administrator', async () => {
    findUnique.mockResolvedValue({ is_superadmin: true, status: 'ACTIVE' });
    await expect(guard.canActivate(makeContext({ user: { id: USER_ID }, headers: {} }))).resolves.toBe(true);
  });
});
