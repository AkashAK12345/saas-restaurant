import { describe, it, expect } from 'vitest';
import { buildCorsOptions, parseOrigins, DEFAULT_CORS_ORIGINS } from './cors.js';

describe('CORS configuration', () => {
  it('defaults to the local web app only', () => {
    expect(parseOrigins(undefined)).toEqual([DEFAULT_CORS_ORIGINS]);
    expect(parseOrigins('')).toEqual([DEFAULT_CORS_ORIGINS]);
  });

  it('parses a comma-separated allowlist, trimming spaces and trailing slashes', () => {
    expect(parseOrigins('https://a.example.com, https://b.example.com/')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('never reflects arbitrary origins — the option is a list, not true', () => {
    const opts = buildCorsOptions('https://app.example.com');
    expect(Array.isArray(opts.origin)).toBe(true);
    expect(opts.origin).toEqual(['https://app.example.com']);
    expect(opts.origin).not.toBe(true);
  });

  it('does not enable ambient credentials — SAMCO authenticates by header', () => {
    expect(buildCorsOptions(undefined).credentials).toBe(false);
  });

  it('allows exactly the headers the clients send', () => {
    const headers = buildCorsOptions(undefined).allowedHeaders as string[];
    for (const h of [
      'Authorization',
      'Content-Type',
      'X-Company-ID',
      'X-Branch-ID',
      'X-Stream-Ticket',
      'Last-Event-ID',
    ]) {
      expect(headers).toContain(h);
    }
    expect(headers).not.toContain('*');
  });

  it('drops empty entries rather than allowing a blank origin', () => {
    expect(parseOrigins('https://a.example.com,,  ,')).toEqual(['https://a.example.com']);
  });

  // Without this a report export downloads under a generic fallback name: the
  // browser hands JavaScript the bytes but hides the header naming the file.
  it('exposes Content-Disposition so a download keeps the name the API gave it', () => {
    const exposed = buildCorsOptions(undefined).exposedHeaders as string[];
    expect(exposed).toContain('Content-Disposition');
    expect(exposed).not.toContain('*');
  });
});
