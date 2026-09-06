import { Injectable } from '@nestjs/common';

/**
 * Injection token for the login attempt store.
 *
 * Swapping the single-instance implementation for a shared/distributed one
 * (Redis, or a database table) is a one-line provider change in AuthModule:
 *
 *   { provide: LOGIN_ATTEMPT_STORE, useClass: RedisLoginAttemptStore }
 *
 * AuthService depends only on the interface below and awaits every call, so a
 * network-backed implementation needs no changes on the consumer side.
 */
export const LOGIN_ATTEMPT_STORE = Symbol('LOGIN_ATTEMPT_STORE');

/**
 * Minimal contract for login brute-force accounting.
 *
 * Every method is allowed to be asynchronous so a remote store can implement it.
 * Implementations MUST behave identically for existing and non-existent
 * accounts: they receive the submitted email as an opaque key and must never
 * consult user records.
 *
 * Implementations MUST NOT persist credential material — only the client IP and
 * the submitted email address.
 */
export interface LoginAttemptStore {
  /** True when this identity or its IP is currently blocked. */
  isBlocked(ip: string, email: string): Promise<boolean> | boolean;
  /** Seconds until the block lifts, for a Retry-After style hint. */
  retryAfterSeconds(ip: string, email: string): Promise<number> | number;
  /** Record one failed attempt. */
  registerFailure(ip: string, email: string): Promise<void> | void;
  /** Clear the identity's failure budget after a successful authentication. */
  registerSuccess(ip: string, email: string): Promise<void> | void;
}


interface AttemptRecord {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number | null;
}

export const LOGIN_THROTTLE = {
  /** Failed attempts allowed per (ip + email) inside WINDOW_MS. */
  MAX_FAILURES_PER_IDENTITY: 5,
  /** Failed attempts allowed per ip inside WINDOW_MS, across all emails. */
  MAX_FAILURES_PER_IP: 50,
  /** Rolling window for counting failures. */
  WINDOW_MS: 15 * 60 * 1000,
  /** How long a key stays blocked once its budget is exhausted. */
  BLOCK_MS: 15 * 60 * 1000,
  /** Hard ceiling on tracked keys, to bound memory. */
  MAX_TRACKED_KEYS: 10_000,
} as const;

/**
 * In-process login brute-force protection.
 *
 * SCOPE AND LIMITS — read before relying on this:
 * This is SINGLE-INSTANCE protection. State lives in this process's memory, so
 * with N API replicas an attacker effectively gets N times the budget, and all
 * counters reset on restart. That is an accepted Phase 1 trade-off: a shared
 * store (Redis) is not part of the current foundation and introducing one solely
 * for this control would add infrastructure the platform does not otherwise need.
 * Moving this to a shared store is tracked as BACKLOG for horizontal scaling.
 *
 * Design notes:
 *  - Only FAILED attempts are counted; a successful login clears the counter.
 *  - Two independent budgets: a tight one per (ip + email) and a loose one per
 *    ip, so a single attacker cannot dodge the first by rotating email addresses.
 *  - Behaviour is identical for existing and non-existent accounts — the
 *    throttle is keyed on the submitted email without ever consulting the
 *    database, so a 429 never reveals whether an account exists.
 *  - No credential material is stored. Keys hold only the client IP and the
 *    submitted email address; passwords never reach this service.
 *  - The map is bounded (MAX_TRACKED_KEYS) with opportunistic pruning so an
 *    attacker cycling random emails cannot grow it without limit.
 *
 * Bypass analysis:
 *  - Rotating the email while holding the IP: caught by the per-IP budget.
 *  - Rotating the IP: NOT caught, and inherently cannot be by IP-based
 *    accounting. Defence against a distributed attack is the per-account
 *    password policy plus the shared-store work tracked as BACKLOG.
 *  - Succeeding on one account to reset the IP budget: not possible, see
 *    registerSuccess.
 */
@Injectable()
export class LoginThrottleService implements LoginAttemptStore {
  private readonly attempts = new Map<string, AttemptRecord>();

  private identityKey(ip: string, email: string): string {
    return `id:${ip}|${email}`;
  }

  private ipKey(ip: string): string {
    return `ip:${ip}`;
  }

  private now(): number {
    return Date.now();
  }

  /**
   * Drop entries whose window has elapsed and which are not actively blocked.
   * Called opportunistically on write paths rather than on a timer, so the
   * service holds no handles and needs no lifecycle management.
   */
  private prune(now: number): void {
    for (const [key, record] of this.attempts) {
      const windowExpired = now - record.windowStartedAt > LOGIN_THROTTLE.WINDOW_MS;
      const notBlocked = record.blockedUntil === null || record.blockedUntil <= now;
      if (windowExpired && notBlocked) {
        this.attempts.delete(key);
      }
    }

    // Still oversized after pruning (sustained distributed attack): evict the
    // oldest entries. Map preserves insertion order.
    if (this.attempts.size > LOGIN_THROTTLE.MAX_TRACKED_KEYS) {
      const excess = this.attempts.size - LOGIN_THROTTLE.MAX_TRACKED_KEYS;
      let removed = 0;
      for (const key of this.attempts.keys()) {
        if (removed >= excess) break;
        this.attempts.delete(key);
        removed++;
      }
    }
  }

  private isKeyBlocked(key: string, now: number): boolean {
    const record = this.attempts.get(key);
    if (!record) return false;
    if (record.blockedUntil !== null && record.blockedUntil > now) return true;

    // Block expired — reset so the caller gets a fresh budget.
    if (record.blockedUntil !== null && record.blockedUntil <= now) {
      this.attempts.delete(key);
    }
    return false;
  }

  /**
   * True when this (ip, email) pair or the ip as a whole is currently blocked.
   * Callers must treat a blocked result identically regardless of whether the
   * account exists.
   */
  isBlocked(ip: string, email: string): boolean {
    const now = this.now();
    return (
      this.isKeyBlocked(this.identityKey(ip, email), now) ||
      this.isKeyBlocked(this.ipKey(ip), now)
    );
  }

  /** Seconds until the relevant block lifts — for a Retry-After style hint. */
  retryAfterSeconds(ip: string, email: string): number {
    const now = this.now();
    const candidates = [this.identityKey(ip, email), this.ipKey(ip)]
      .map((k) => this.attempts.get(k)?.blockedUntil ?? 0)
      .filter((until) => until > now);
    if (candidates.length === 0) return 0;
    return Math.ceil((Math.max(...candidates) - now) / 1000);
  }

  private registerFailureFor(key: string, limit: number, now: number): void {
    const record = this.attempts.get(key);

    if (!record || now - record.windowStartedAt > LOGIN_THROTTLE.WINDOW_MS) {
      this.attempts.set(key, {
        failures: 1,
        windowStartedAt: now,
        blockedUntil: null,
      });
      return;
    }

    record.failures += 1;
    if (record.failures >= limit) {
      record.blockedUntil = now + LOGIN_THROTTLE.BLOCK_MS;
    }
  }

  /** Record one failed login attempt against both budgets. */
  registerFailure(ip: string, email: string): void {
    const now = this.now();
    this.registerFailureFor(
      this.identityKey(ip, email),
      LOGIN_THROTTLE.MAX_FAILURES_PER_IDENTITY,
      now,
    );
    this.registerFailureFor(
      this.ipKey(ip),
      LOGIN_THROTTLE.MAX_FAILURES_PER_IP,
      now,
    );
    this.prune(now);
  }

  /**
   * Clear the per-identity budget after a successful authentication.
   *
   * The per-IP budget is deliberately NOT cleared. An attacker who controls one
   * valid account could otherwise reset their IP budget at will and spray other
   * accounts indefinitely.
   */
  registerSuccess(ip: string, email: string): void {
    this.attempts.delete(this.identityKey(ip, email));
    this.prune(this.now());
  }

  /** Test-only helper so suites can start from a known state. */
  reset(): void {
    this.attempts.clear();
  }
}
