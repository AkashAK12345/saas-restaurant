import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { StreamTicketGuard } from './stream-ticket.guard.js';
import type { StreamTicketStore } from './stream-ticket.service.js';
import type { StreamAccessService } from './stream-access.service.js';
import { RealtimeChannel } from './channels.js';

const RECORD = {
  subject: { kind: 'staff' as const, userId: 'u1' },
  scope: { companyId: 'c1', branchId: 'b1', channel: RealtimeChannel.QUEUE },
  expiresAt: Date.now() + 60_000,
};

function ctx(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('StreamTicketGuard', () => {
  let tickets: { consume: ReturnType<typeof vi.fn> };
  let access: { isStillAuthorized: ReturnType<typeof vi.fn> };
  let guard: StreamTicketGuard;

  beforeEach(() => {
    tickets = { consume: vi.fn().mockReturnValue(RECORD) };
    access = { isStillAuthorized: vi.fn().mockResolvedValue(true) };
    guard = new StreamTicketGuard(
      tickets as unknown as StreamTicketStore,
      access as unknown as StreamAccessService,
    );
  });

  it('accepts the ticket from the X-Stream-Ticket header', async () => {
    const req = { headers: { 'x-stream-ticket': 't1' }, query: {} };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(tickets.consume).toHaveBeenCalledWith('t1');
    expect(req).toHaveProperty('stream', RECORD);
  });

  it('accepts the ticket from ?ticket= (the EventSource path)', async () => {
    const req = { headers: {}, query: { ticket: 't2' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(tickets.consume).toHaveBeenCalledWith('t2');
  });

  it('header wins over query when both are present', async () => {
    const req = { headers: { 'x-stream-ticket': 'h' }, query: { ticket: 'q' } };
    await guard.canActivate(ctx(req));
    expect(tickets.consume).toHaveBeenCalledWith('h');
  });

  it('ignores Authorization entirely — a JWT or display credential is not a ticket', async () => {
    tickets.consume.mockReturnValue(null);
    const req = { headers: { authorization: 'Bearer some.jwt' }, query: {} };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tickets.consume).toHaveBeenCalledWith(undefined);
  });

  it('rejects an unknown/expired/used ticket with one generic 401', async () => {
    tickets.consume.mockReturnValue(null);
    const err = await guard.canActivate(ctx({ headers: {}, query: { ticket: 'x' } })).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid stream ticket');
    expect(access.isStillAuthorized).not.toHaveBeenCalled();
  });

  it('re-verifies authorization at connect and rejects if it has lapsed', async () => {
    access.isStillAuthorized.mockResolvedValue(false);
    const err = await guard.canActivate(ctx({ headers: {}, query: { ticket: 'x' } })).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid stream ticket'); // same generic message
    expect(access.isStillAuthorized).toHaveBeenCalledWith(RECORD);
  });

  it('consumes the ticket BEFORE re-verifying, so a failed attempt still burns it', async () => {
    access.isStillAuthorized.mockResolvedValue(false);
    await guard.canActivate(ctx({ headers: {}, query: { ticket: 'x' } })).catch(() => undefined);
    expect(tickets.consume).toHaveBeenCalledTimes(1);
  });
});
