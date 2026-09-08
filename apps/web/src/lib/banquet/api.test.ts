import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { banquetApi } from './api';
import { apiBaseUrl } from '@/lib/api/client';
import { sessionStore } from '@/lib/auth/session-store';

const CTX = { companyId: 'co-1', branchId: 'br-1' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('banquetApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStore.setAccessToken('tok');
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

  it('sends the branch context for branch-scoped resources', async () => {
    await banquetApi.listBookings(CTX);
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['X-Company-ID']).toBe('co-1');
    expect(headers['X-Branch-ID']).toBe('br-1');
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it('sends ONLY the company context for packages — they are not branch-scoped', async () => {
    await banquetApi.listPackages(CTX);
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['X-Company-ID']).toBe('co-1');
    expect(headers['X-Branch-ID']).toBeUndefined();
  });

  it.each([
    ['confirm', (id: string) => banquetApi.confirmBooking(CTX, id), '/confirm'],
    ['complete', (id: string) => banquetApi.completeBooking(CTX, id), '/complete'],
    ['cancel', (id: string) => banquetApi.cancelBooking(CTX, id), '/cancel'],
  ])('%s POSTs to its own explicit operation', async (_label, run, suffix) => {
    await run('bk-1');
    const { url, init } = lastCall();
    expect(url).toBe(`${apiBaseUrl()}/banquet/bookings/bk-1${suffix}`);
    expect(init.method).toBe('POST');
  });

  it('never sends a status field — lifecycle is not client-settable', async () => {
    await banquetApi.createBooking(CTX, {
      customer_id: 'c1',
      hall_id: 'h1',
      package_id: 'p1',
      starts_at: '2027-01-01T10:00:00.000Z',
      ends_at: '2027-01-01T14:00:00.000Z',
      guest_count: 40,
    });
    await banquetApi.updateBooking(CTX, 'bk-1', { guest_count: 50 });
    for (const [, init] of fetchMock.mock.calls) {
      const body = (init as RequestInit).body;
      if (typeof body === 'string') expect(body).not.toContain('"status"');
    }
  });

  it('sends money as whole minor units', async () => {
    await banquetApi.createPayment(CTX, 'bk-1', { amount_minor: 1_250_050, currency: 'INR' });
    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ amount_minor: 1_250_050, currency: 'INR' });
    expect(Number.isInteger(body.amount_minor)).toBe(true);
  });

  it('uses PUT for the event plan, which is a replace-style upsert', async () => {
    await banquetApi.saveEventPlan(CTX, 'bk-1', { kitchen_notes: 'No nuts' });
    const { url, init } = lastCall();
    expect(url).toBe(`${apiBaseUrl()}/banquet/bookings/bk-1/event-plan`);
    expect(init.method).toBe('PUT');
  });

  it('requests the banquet-kds ticket, not the queue one', async () => {
    await banquetApi.streamTicket(CTX);
    expect(lastCall().url).toBe(`${apiBaseUrl()}/realtime/tickets/banquet-kds`);
  });

  it('passes booking filters through as query parameters', async () => {
    await banquetApi.listBookings(CTX, { status: 'CONFIRMED', hall_id: 'h1', limit: 10 });
    const { url } = lastCall();
    expect(url).toContain('status=CONFIRMED');
    expect(url).toContain('hall_id=h1');
    expect(url).toContain('limit=10');
  });

  it('never puts a token in a banquet URL', async () => {
    sessionStore.setSession({ accessToken: 'secret-access', refreshToken: 'secret-refresh' });
    await banquetApi.listBookings(CTX);
    await banquetApi.streamTicket(CTX);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('secret-access');
      expect(String(url)).not.toContain('secret-refresh');
    }
  });
});
