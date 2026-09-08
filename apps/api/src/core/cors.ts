import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/**
 * Browser access to the API.
 *
 * The web app is served from a different origin than the API (3000 vs 3001 in
 * development), so without this every request from a real browser is blocked
 * before it is sent. Nothing before Phase 7 noticed, because the frontend
 * tests mock fetch and the E2E suites call the server in-process.
 *
 * ALLOWLIST, NOT REFLECTION. `CORS_ORIGINS` is a comma-separated list of exact
 * origins; anything not on it is refused. Reflecting the caller's Origin back
 * would let any site on the internet script the API against a user's browser.
 *
 * `credentials` stays FALSE on purpose: SAMCO authenticates with an
 * Authorization header (and display devices with their own header scheme), not
 * with cookies, so the browser never needs to attach ambient credentials —
 * which also means a cross-site request cannot ride on an existing session.
 */
export const DEFAULT_CORS_ORIGINS = 'http://localhost:3000';

export function parseOrigins(raw: string | undefined): string[] {
  // An unset OR blank value falls back to the default. `??` alone would let an
  // empty CORS_ORIGINS="" silently allow nothing, which fails as a confusing
  // browser error rather than as a configuration mistake.
  return (raw && raw.trim() ? raw : DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
}

export function buildCorsOptions(raw: string | undefined): CorsOptions {
  return {
    origin: parseOrigins(raw),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      // Requested tenant context; the guards still prove the caller may use it.
      'X-Company-ID',
      'X-Branch-ID',
      // Single-use SSE ticket, when sent as a header rather than a query param.
      'X-Stream-Ticket',
      'Last-Event-ID',
    ],
    // A cross-origin response only hands JavaScript the CORS-safelisted
    // headers. Without this the browser can read a report export's bytes but
    // not the filename the server chose for it, and every download saves under
    // a generic fallback name.
    exposedHeaders: ['Content-Disposition'],
    credentials: false,
    maxAge: 600,
  };
}
