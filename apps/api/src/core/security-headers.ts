import type { NextFunction, Request, Response } from 'express';

/**
 * Response hardening for the API.
 *
 * Every response is JSON, a file download or an event stream — never a page —
 * so the policy can be as strict as it gets: nothing may be framed, sniffed,
 * embedded or leak a referrer. Written out here rather than adding a
 * dependency for six headers; each line is the whole reason for itself.
 *
 * HSTS is sent only when the deployment says it is behind HTTPS
 * (production). Sending it from a plain-HTTP dev server would pin browsers to
 * a scheme that is not there.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

export function securityHeaders(options: { hsts: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) res.setHeader(key, value);
    if (options.hsts) res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    res.removeHeader('X-Powered-By');
    next();
  };
}

/**
 * Express `trust proxy` from TRUST_PROXY.
 *
 * Behind a load balancer every request arrives from the proxy's address, so
 * the login throttle — keyed partly on client IP — would put every user in
 * one bucket. Trusting the proxy makes `req.ip` the real client. It is OFF
 * unless configured, because trusting X-Forwarded-For from the open internet
 * lets anyone choose their own IP and walk around the throttle.
 *
 *   unset / ""     → leave Express's default (do not trust)
 *   "true"/"false" → boolean
 *   "1", "2"       → trust that many hops
 *   anything else  → passed through (e.g. "loopback, 10.0.0.0/8")
 */
export function trustProxySetting(value: string | undefined): boolean | number | string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const v = value.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
