import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { queueApi } from './api';
import { apiBaseUrl } from '@/lib/api/client';
import { sessionStore } from '@/lib/auth/session-store';

const CTX = { companyId: 'co-1', branchId: 'br-1' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('queueApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStore.setAccessToken('tok');
    // A Response body can only be read once, so build a fresh one per call.
    fetchMock = vi.fn().mockImplementation(() => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStore.clear();
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url: String(url), init: init as RequestInit };
  };

  it('sends the branch context on every queue call', async () => {
    await queueApi.board(CTX);
    const { url, init } = lastCall();
    expect(url).toBe(`${apiBaseUrl()}/queue-tokens/board`);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Company-ID']).toBe('co-1');
    expect(headers['X-Branch-ID']).toBe('br-1');
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it.each([
    ['call', (id: string) => queueApi.call(CTX, id), '/call'],
    ['seat', (id: string) => queueApi.seat(CTX, id), '/seat'],
    ['noShow', (id: string) => queueApi.noShow(CTX, id), '/no-show'],
    ['cancel', (id: string) => queueApi.cancel(CTX, id), '/cancel'],
    ['releaseTable', (id: string) => queueApi.releaseTable(CTX, id), '/release-table'],
  ])('%s POSTs to the explicit operation endpoint', async (_label, run, suffix) => {
    await run('tok-9');
    const { url, init } = lastCall();
    expect(url).toBe(`${apiBaseUrl()}/queue-tokens/tok-9${suffix}`);
    expect(init.method).toBe('POST');
  });

  it('never sends a status field — status is not client-settable', async () => {
    await queueApi.register(CTX, { party_size: 3 });
    await queueApi.seat(CTX, 't1', 'table-1');
    for (const [, init] of fetchMock.mock.calls) {
      const body = (init as RequestInit).body;
      if (typeof body === 'string') expect(body).not.toContain('status');
    }
  });

  it('registers a walk-in without a customer, and with one when given', async () => {
    await queueApi.register(CTX, { party_size: 2 });
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ party_size: 2 });

    await queueApi.register(CTX, { party_size: 2, customer_id: 'c-1' });
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      party_size: 2,
      customer_id: 'c-1',
    });
  });

  it('seats with a table only when one is chosen', async () => {
    await queueApi.seat(CTX, 't1');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({});
    await queueApi.seat(CTX, 't1', 'table-7');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ table_id: 'table-7' });
  });

  it('passes list filters through as query parameters', async () => {
    await queueApi.list(CTX, { status: 'WAITING', service_date: '2026-09-07', limit: 10, offset: 20 });
    const { url } = lastCall();
    expect(url).toContain('status=WAITING');
    expect(url).toContain('service_date=2026-09-07');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=20');
  });

  it('scopes customers to the company only — a customer is not branch-scoped', async () => {
    await queueApi.customers(CTX);
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['X-Company-ID']).toBe('co-1');
    expect(headers['X-Branch-ID']).toBeUndefined();
  });

  it('requests the queue stream ticket from the staff endpoint', async () => {
    await queueApi.streamTicket(CTX);
    const { url, init } = lastCall();
    expect(url).toBe(`${apiBaseUrl()}/realtime/tickets/queue`);
    expect(init.method).toBe('POST');
  });

  it('never puts a token or credential in a queue URL', async () => {
    sessionStore.setSession({ accessToken: 'secret-access', refreshToken: 'secret-refresh' });
    await queueApi.board(CTX);
    await queueApi.streamTicket(CTX);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('secret-access');
      expect(String(url)).not.toContain('secret-refresh');
    }
  });
});
