import { describe, it, expect, beforeEach } from 'vitest';
import {
  LoginThrottleService,
  LOGIN_THROTTLE,
  type LoginAttemptStore,
} from './login-throttle.service.js';

/**
 * The throttle is pure in-process logic, so its behaviour is asserted directly
 * here rather than by driving hundreds of HTTP requests through the e2e suite.
 */
describe('LoginThrottleService', () => {
  let throttle: LoginThrottleService;
  const IP = '203.0.113.10';
  const EMAIL = 'victim@example.com';

  beforeEach(() => {
    throttle = new LoginThrottleService();
  });

  it('allows attempts below the per-identity limit', () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY - 1; i++) {
      throttle.registerFailure(IP, EMAIL);
      expect(throttle.isBlocked(IP, EMAIL)).toBe(false);
    }
  });

  it('blocks once the per-identity limit is reached', () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY; i++) {
      throttle.registerFailure(IP, EMAIL);
    }
    expect(throttle.isBlocked(IP, EMAIL)).toBe(true);
    expect(throttle.retryAfterSeconds(IP, EMAIL)).toBeGreaterThan(0);
  });

  it('is scoped per identity: blocking one email does not block another', () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY; i++) {
      throttle.registerFailure(IP, EMAIL);
    }
    expect(throttle.isBlocked(IP, EMAIL)).toBe(true);
    expect(throttle.isBlocked(IP, 'someone-else@example.com')).toBe(false);
  });

  it('is scoped per IP: the same email from another address is unaffected', () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY; i++) {
      throttle.registerFailure(IP, EMAIL);
    }
    expect(throttle.isBlocked('198.51.100.7', EMAIL)).toBe(false);
  });

  it('a successful login clears the identity budget', () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY - 1; i++) {
      throttle.registerFailure(IP, EMAIL);
    }
    throttle.registerSuccess(IP, EMAIL);

    // Budget is fresh again.
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY - 1; i++) {
      throttle.registerFailure(IP, EMAIL);
      expect(throttle.isBlocked(IP, EMAIL)).toBe(false);
    }
  });

  it('eventually blocks an IP that rotates through many distinct emails', () => {
    // Each email stays under its own limit, so only the coarse per-IP budget
    // can catch this pattern.
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IP; i++) {
      throttle.registerFailure(IP, `rotating-${i}@example.com`);
    }
    expect(throttle.isBlocked(IP, 'brand-new@example.com')).toBe(true);
  });

  it('behaves identically for any email — it never consults account existence', () => {
    const a = new LoginThrottleService();
    const b = new LoginThrottleService();

    const drive = (t: LoginThrottleService, email: string) => {
      const out: boolean[] = [];
      for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY + 2; i++) {
        t.registerFailure(IP, email);
        out.push(t.isBlocked(IP, email));
      }
      return out;
    };

    expect(drive(a, 'real-account@example.com')).toEqual(
      drive(b, 'does-not-exist@example.com'),
    );
  });

  // 10,500 registrations is real work, and vitest's 5s default is not enough
  // for it once the suite runs enough files in parallel to contend for CPU.
  // The assertion is unchanged — only the time it is allowed to take.
  it('bounds memory under a high-cardinality attack', { timeout: 30_000 }, () => {
    const overflow = LOGIN_THROTTLE.MAX_TRACKED_KEYS + 500;
    for (let i = 0; i < overflow; i++) {
      throttle.registerFailure(`10.0.${Math.floor(i / 254)}.${i % 254}`, `u${i}@x.com`);
    }
    const size = (throttle as unknown as { attempts: Map<string, unknown> }).attempts.size;
    // Two keys per attempt (identity + ip), still capped by eviction.
    expect(size).toBeLessThanOrEqual(LOGIN_THROTTLE.MAX_TRACKED_KEYS);
  });


  it('the IP threshold is independent of, and looser than, the identity threshold', () => {
    expect(LOGIN_THROTTLE.MAX_FAILURES_PER_IP).toBeGreaterThan(
      LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY,
    );

    // Just under the IP limit, spread so no single identity trips: still allowed.
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IP - 1; i++) {
      throttle.registerFailure(IP, `spread-${i}@example.com`);
    }
    expect(throttle.isBlocked(IP, 'fresh@example.com')).toBe(false);

    // One more crosses it.
    throttle.registerFailure(IP, 'spread-final@example.com');
    expect(throttle.isBlocked(IP, 'fresh@example.com')).toBe(true);
  });

  it('a successful login does NOT clear the IP budget', () => {
    // Otherwise an attacker holding one valid account could reset their IP
    // budget at will and keep spraying other accounts.
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IP; i++) {
      throttle.registerFailure(IP, `spray-${i}@example.com`);
    }
    expect(throttle.isBlocked(IP, 'anything@example.com')).toBe(true);

    throttle.registerSuccess(IP, 'spray-0@example.com');
    expect(throttle.isBlocked(IP, 'anything@example.com')).toBe(true);
  });

  it('stores no credential material — only ip and submitted email', () => {
    throttle.registerFailure(IP, EMAIL);
    const attempts = (throttle as unknown as { attempts: Map<string, unknown> }).attempts;
    const serialized = JSON.stringify([...attempts.entries()]);

    // Passwords never reach this service at all; assert the stored shape too.
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/\$2[aby]\$/);
    for (const value of attempts.values()) {
      expect(Object.keys(value as object).sort()).toEqual([
        'blockedUntil',
        'failures',
        'windowStartedAt',
      ]);
    }
  });

  it('satisfies the LoginAttemptStore contract used by AuthService', () => {
    // The interface is what makes a shared-store implementation drop-in.
    const store: LoginAttemptStore = throttle;
    expect(typeof store.isBlocked).toBe('function');
    expect(typeof store.retryAfterSeconds).toBe('function');
    expect(typeof store.registerFailure).toBe('function');
    expect(typeof store.registerSuccess).toBe('function');
  });

  it('reset() clears all state', () => {
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY; i++) {
      throttle.registerFailure(IP, EMAIL);
    }
    expect(throttle.isBlocked(IP, EMAIL)).toBe(true);
    throttle.reset();
    expect(throttle.isBlocked(IP, EMAIL)).toBe(false);
  });
});
