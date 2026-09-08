import { sessionStore } from '@/lib/auth/session-store';
import type { ApiErrorBody, RefreshResponse } from './types';

/**
 * The one place the frontend talks HTTP to the SAMCO API.
 *
 * Centralises: base URL, JSON encoding/decoding, the error envelope, the
 * Authorization header, the X-Company-ID / X-Branch-ID *context* headers, and
 * the refresh-once-on-401 dance. Components never call fetch directly.
 *
 * Context headers are exactly that — requested context. The backend proves
 * membership and permission on every call; sending a header for a company the
 * user does not belong to simply yields a 403/404 from the server.
 */

const DEFAULT_BASE = 'http://localhost:3001';

export function apiBaseUrl(): string {
  // Only NEXT_PUBLIC_* variables reach the browser bundle. Set
  // NEXT_PUBLIC_API_URL in apps/web/.env.local for non-default deployments.
  const raw = process.env.NEXT_PUBLIC_API_URL || DEFAULT_BASE;
  return raw.replace(/\/+$/, '') + '/api/v1';
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    const msg = body
      ? Array.isArray(body.message)
        ? body.message.join('; ')
        : body.message
      : fallback;
    super(msg || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Raised when there is no usable session and the request required one. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'NotAuthenticatedError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Attach the access token (default true). Login/refresh set this false. */
  auth?: boolean;
  companyId?: string | null;
  branchId?: string | null;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Listeners told when a refresh definitively fails, so UI can send the user to login. */
type SessionLostListener = () => void;
const sessionLostListeners = new Set<SessionLostListener>();
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}
function emitSessionLost(): void {
  sessionStore.clear();
  for (const l of sessionLostListeners) l();
}

// A single in-flight refresh shared by every concurrent 401, so ten parallel
// requests expiring together produce one rotation, not ten (which the
// backend's replay detection would rightly treat as an attack).
let refreshInFlight: Promise<boolean> | null = null;

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rawRequest<T>(path: string, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const token = sessionStore.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  if (opts.companyId) headers['X-Company-ID'] = opts.companyId;
  if (opts.branchId) headers['X-Branch-ID'] = opts.branchId;

  const res = await fetch(apiBaseUrl() + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const data = await parseBody(res);
  if (!res.ok) {
    const body =
      data && typeof data === 'object' && 'statusCode' in (data as object)
        ? (data as ApiErrorBody)
        : null;
    throw new ApiError(res.status, body, `Request failed (${res.status})`);
  }
  return data as T;
}

/**
 * Exchange the stored refresh token for a new pair. Returns false when there
 * is nothing to refresh with or the backend refuses; in that case the session
 * is cleared and listeners are notified.
 */
export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const attempt = (async () => {
    const refreshToken = sessionStore.getRefreshToken();
    if (!refreshToken) {
      emitSessionLost();
      return false;
    }
    try {
      const tokens = await rawRequest<RefreshResponse>('/auth/refresh', {
        method: 'POST',
        auth: false,
        body: { refreshToken },
      });
      sessionStore.setSession(tokens);
      return true;
    } catch {
      emitSessionLost();
      return false;
    }
  })();

  refreshInFlight = attempt;
  // Clear the shared slot only once THIS attempt settles, and only if it is
  // still the current one. Callers that arrived while it was in flight already
  // hold the same promise; callers arriving afterwards start a fresh refresh.
  // (A `finally` inside the IIFE would run before the assignment above when
  // the body completes synchronously, caching an already-settled promise.)
  void attempt.finally(() => {
    if (refreshInFlight === attempt) refreshInFlight = null;
  });

  return attempt;
}

/**
 * Make an API request. On a 401 for an authenticated request, refresh once and
 * retry once; if that fails the caller sees NotAuthenticatedError and the
 * session-lost listeners fire.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (opts.auth !== false && !sessionStore.getAccessToken()) {
    // No access token yet (fresh load). Try to mint one before the first call
    // rather than burning a request to discover we are logged out.
    const ok = await refreshSession();
    if (!ok) throw new NotAuthenticatedError();
  }

  try {
    return await rawRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized && opts.auth !== false) {
      const ok = await refreshSession();
      if (!ok) throw new NotAuthenticatedError();
      return rawRequest<T>(path, opts);
    }
    throw err;
  }
}

/** Convenience wrappers so call sites read naturally. */
export const api = {
  get: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  /** For replace-style upserts, e.g. a booking's single event plan. */
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  /** For unauthenticated endpoints (login). */
  public: <T>(path: string, opts: RequestOptions = {}) => rawRequest<T>(path, { ...opts, auth: false }),
};
