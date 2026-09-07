import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { displayApi, DisplayAuthError } from './display-api';
import { deviceSession, isWellFormedCredential } from './device-session';
import { apiBaseUrl } from '@/lib/api/client';

const CREDENTIAL = '11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64);
const SESSION = { credential: CREDENTIAL, branchId: 'br-1' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('device session', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a credential and branch', () => {
    expect(deviceSession.get()).toBeNull();
    deviceSession.set(SESSION);
    expect(deviceSession.get()).toEqual(SESSION);
    deviceSession.clear();
    expect(deviceSession.get()).toBeNull();
  });

  it('needs both halves to count as paired', () => {
    window.localStorage.setItem('samco.display.credential', CREDENTIAL);
    expect(deviceSession.get()).toBeNull();
  });

  it.each([
    ['valid', CREDENTIAL, true],
    ['no secret', '11111111-1111-4111-8111-111111111111', false],
    ['non-uuid device', 'nope.' + 'a'.repeat(64), false],
    ['short secret', '11111111-1111-4111-8111-111111111111.abc', false],
    ['extra segment', CREDENTIAL + '.more', false],
    ['empty', '', false],
  ])('shape check: %s', (_label, value, expected) => {
    expect(isWellFormedCredential(value)).toBe(expected);
  });
});

describe('displayApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // A Response body can only be read once, so build a fresh one per call.
    fetchMock = vi.fn().mockImplementation(() => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url: String(url), init: init as RequestInit };
  };

  it('sends the credential in the Authorization header with the device scheme', async () => {
    await displayApi.me(SESSION);
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Display ${CREDENTIAL}`);
    expect(headers['X-Branch-ID']).toBe('br-1');
  });

  it('NEVER puts the credential in a URL', async () => {
    await displayApi.me(SESSION);
    await displayApi.customerBoard(SESSION);
    await displayApi.streamTicket(SESSION);
    const secret = CREDENTIAL.split('.')[1];
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(secret);
      expect(String(url)).not.toContain(CREDENTIAL);
    }
  });

  it('asks for the same board endpoint whichever kind the device is', async () => {
    await displayApi.customerBoard(SESSION);
    expect(lastCall().url).toBe(`${apiBaseUrl()}/display/queue/board`);
    await displayApi.adminBoard(SESSION);
    // The SERVER picks the projection from the device row; the client cannot
    // request the richer one by asking differently.
    expect(lastCall().url).toBe(`${apiBaseUrl()}/display/queue/board`);
  });

  it('requests a queue ticket over POST with the channel in the body', async () => {
    await displayApi.streamTicket(SESSION);
    const { url, init } = lastCall();
    expect(url).toBe(`${apiBaseUrl()}/display/stream-tickets`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'queue' });
  });

  it('turns 401 and 403 into a pairing error without echoing the credential', async () => {
    for (const status of [401, 403]) {
      fetchMock.mockImplementation(() => json(status, { statusCode: status, message: 'nope' }));
      const err = await displayApi.customerBoard(SESSION).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DisplayAuthError);
      expect((err as Error).message).not.toContain(CREDENTIAL.split('.')[1]);
    }
  });

  it('reports other failures as plain errors', async () => {
    fetchMock.mockImplementation(() => json(500, { statusCode: 500, message: 'boom' }));
    await expect(displayApi.customerBoard(SESSION)).rejects.toThrow(/500/);
  });
});
