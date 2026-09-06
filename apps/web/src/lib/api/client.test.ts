import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, apiRequest, ApiError, NotAuthenticatedError, onSessionLost, apiBaseUrl } from './client';
import { sessionStore } from '@/lib/auth/session-store';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    sessionStore.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes /api/v1 onto the configured base URL', () => {
    expect(apiBaseUrl()).toMatch(/\/api\/v1$/);
  });

  it('sends Authorization and context headers, and parses JSON', async () => {
    sessionStore.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const res = await api.get<{ ok: boolean }>('/customers', { companyId: 'co-1', branchId: 'br-1' });

    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${apiBaseUrl()}/customers`);
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['X-Company-ID']).toBe('co-1');
    expect(headers['X-Branch-ID']).toBe('br-1');
    expect(init.method).toBe('GET');
  });

  it('serialises bodies as JSON with the right content type', async () => {
    sessionStore.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'x' }));
    await api.post('/customers', { name: 'A' }, { companyId: 'co-1' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ name: 'A' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns the backend error envelope into ApiError with status + message', async () => {
    sessionStore.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse(403, { statusCode: 403, message: 'Forbidden', path: '/x' }));

    const err = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.isForbidden).toBe(true);
    expect(err.message).toBe('Forbidden');
  });

  it('joins array validation messages', async () => {
    sessionStore.setAccessToken('tok');
    fetchMock.mockResolvedValue(jsonResponse(400, { statusCode: 400, message: ['name must not be empty', 'phone invalid'] }));
    const err = (await api.post('/customers', {}).catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe('name must not be empty; phone invalid');
  });

  it('handles 204 and non-JSON bodies without throwing', async () => {
    sessionStore.setAccessToken('tok');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.post('/auth/logout', {})).resolves.toBeNull();
  });

  it('with no session at all, an authenticated call fails fast with NotAuthenticatedError', async () => {
    const lost = vi.fn();
    const off = onSessionLost(lost);
    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lost).toHaveBeenCalledTimes(1);
    off();
  });

  it('on 401: refreshes ONCE and retries the original request', async () => {
    sessionStore.setSession({ accessToken: 'stale', refreshToken: 'refresh-1' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(jsonResponse(200, { me: true }));

    const res = await api.get('/auth/me');

    expect(res).toEqual({ me: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/auth\/refresh$/);
    // Retry used the rotated token and the store holds the rotated pair.
    expect((fetchMock.mock.calls[2][1].headers as Record<string, string>)['Authorization']).toBe('Bearer fresh');
    expect(sessionStore.getRefreshToken()).toBe('refresh-2');
  });

  it('on 401 when refresh is refused: clears the session, notifies, and does not loop', async () => {
    sessionStore.setSession({ accessToken: 'stale', refreshToken: 'refresh-1' });
    const lost = vi.fn();
    const off = onSessionLost(lost);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, message: 'Invalid refresh token' }));

    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sessionStore.getAccessToken()).toBeNull();
    expect(sessionStore.getRefreshToken()).toBeNull();
    expect(lost).toHaveBeenCalledTimes(1);
    off();
  });

  it('concurrent 401s share ONE refresh — the backend would treat two as a replay', async () => {
    sessionStore.setSession({ accessToken: 'stale', refreshToken: 'refresh-1' });
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)['Authorization'];
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'refresh-2' });
      }
      return auth === 'Bearer fresh'
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, { statusCode: 401, message: 'Unauthorized' });
    });

    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it('public requests never attach a token and never trigger refresh', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { statusCode: 401, message: 'Invalid credentials' }));
    const err = (await api
      .public('/auth/login', { method: 'POST', body: { email: 'x', password: 'y' } })
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('never puts credentials in the URL', async () => {
    sessionStore.setSession({ accessToken: 'secret-access', refreshToken: 'secret-refresh' });
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await apiRequest('/anything', { companyId: 'co' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain('secret-access');
    expect(url).not.toContain('secret-refresh');
  });
});
