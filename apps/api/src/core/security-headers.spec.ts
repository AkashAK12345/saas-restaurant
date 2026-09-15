import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { API_SECURITY_HEADERS, HSTS_VALUE, securityHeaders, trustProxySetting } from './security-headers.js';

function fakeResponse() {
  const headers = new Map<string, string>([['X-Powered-By', 'Express']]);
  const res = {
    setHeader: vi.fn((k: string, v: string) => headers.set(k, v)),
    removeHeader: vi.fn((k: string) => headers.delete(k)),
  };
  return { res: res as unknown as Response, headers };
}

describe('API security headers', () => {
  it('sets the full hardening set, drops X-Powered-By and continues', () => {
    const { res, headers } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;
    securityHeaders({ hsts: false })({} as Request, res, next);

    for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect([key, headers.get(key)]).toEqual([key, value]);
    }
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.has('X-Powered-By')).toBe(false);
    expect(headers.has('Strict-Transport-Security')).toBe(false);
    expect(next).toHaveBeenCalledOnce();
  });

  it('adds HSTS only when the deployment is HTTPS', () => {
    const { res, headers } = fakeResponse();
    securityHeaders({ hsts: true })({} as Request, res, vi.fn() as unknown as NextFunction);
    expect(headers.get('Strict-Transport-Security')).toBe(HSTS_VALUE);
  });
});

describe('TRUST_PROXY parsing', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['  ', undefined],
    ['true', true],
    ['false', false],
    ['1', 1],
    ['2', 2],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('%j → %j', (input, expected) => {
    expect(trustProxySetting(input)).toEqual(expected);
  });
});
