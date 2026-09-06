import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { DisplayDeviceKind } from '@samco/database';
import type { RealtimeScope } from './event-broker.js';

/**
 * Who a stream ticket was minted for. Re-verified at connect time — the
 * ticket proves the mint was authorized, not that the subject is still valid.
 */
export type StreamSubject =
  | { kind: 'staff'; userId: string }
  | { kind: 'display'; deviceId: string; displayKind: DisplayDeviceKind };

export interface StreamTicketRecord {
  subject: StreamSubject;
  scope: RealtimeScope;
  expiresAt: number;
}

/**
 * Short-lived, single-use bearer ticket exchanged for an SSE connection.
 *
 * WHY A TICKET: browsers' EventSource cannot set request headers, so the only
 * way to authenticate a stream is something in the URL. Putting a staff JWT or
 * a long-lived display credential there would leak it into proxy/access logs
 * and browser history. A ticket that expires in seconds and dies on first use
 * bounds that exposure to one connection attempt.
 *
 * Contract (any implementation, including a future shared store):
 *   - `issue` returns a cryptographically random raw ticket; only a hash is kept.
 *   - `consume` atomically validates AND deletes: a ticket authenticates at
 *     most one connection. A second presentation is treated as unknown.
 *   - expired tickets are never returned.
 *   - the raw ticket is never persisted or logged.
 */
export interface StreamTicketStore {
  issue(record: Omit<StreamTicketRecord, 'expiresAt'>): { ticket: string; expiresAt: number };
  consume(rawTicket: string | undefined): StreamTicketRecord | null;
}

export const STREAM_TICKET_STORE = Symbol('STREAM_TICKET_STORE');

export const STREAM_TICKET = {
  /** Enough for an EventSource to be constructed and connect; not enough to sit in a log usefully. */
  DEFAULT_TTL_MS: 60_000,
  /** Bounded to keep memory finite under abuse. */
  MAX_OUTSTANDING: 10_000,
} as const;

/**
 * In-memory store. Single-instance for the same reason as the broker: a ticket
 * minted on one replica is unknown to another. BACKLOG alongside the broker.
 */
@Injectable()
export class InMemoryStreamTicketStore implements StreamTicketStore {
  private readonly tickets = new Map<string, StreamTicketRecord>();

  constructor(private readonly ttlMs: number = STREAM_TICKET.DEFAULT_TTL_MS) {}

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Runs only when the cap is reached, so the normal path is O(1). Expired
   * tickets are swept first; if still over the cap (a burst of live tickets —
   * i.e. abuse), the oldest are evicted. Memory is therefore bounded by
   * MAX_OUTSTANDING regardless of TTL.
   */
  private enforceCap(now: number): void {
    if (this.tickets.size <= STREAM_TICKET.MAX_OUTSTANDING) return;
    for (const [key, rec] of this.tickets) {
      if (rec.expiresAt <= now) this.tickets.delete(key);
    }
    const excess = this.tickets.size - STREAM_TICKET.MAX_OUTSTANDING;
    if (excess <= 0) return;
    let removed = 0;
    for (const key of this.tickets.keys()) {
      if (removed >= excess) break;
      this.tickets.delete(key);
      removed++;
    }
  }

  issue(record: Omit<StreamTicketRecord, 'expiresAt'>): { ticket: string; expiresAt: number } {
    const now = Date.now();
    const ticket = crypto.randomBytes(32).toString('hex');
    const expiresAt = now + this.ttlMs;
    this.tickets.set(this.hash(ticket), { ...record, expiresAt });
    this.enforceCap(now);
    return { ticket, expiresAt };
  }

  consume(rawTicket: string | undefined): StreamTicketRecord | null {
    if (!rawTicket || typeof rawTicket !== 'string' || rawTicket.length !== 64) return null;
    const key = this.hash(rawTicket);
    const rec = this.tickets.get(key);
    // Single use: removed before any other check so even an expired ticket is
    // gone after one presentation.
    this.tickets.delete(key);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) return null;
    return rec;
  }

  /** Test-only visibility. */
  outstanding(): number {
    return this.tickets.size;
  }
}
