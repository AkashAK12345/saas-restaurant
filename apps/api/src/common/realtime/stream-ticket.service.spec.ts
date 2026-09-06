import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryStreamTicketStore, STREAM_TICKET } from './stream-ticket.service.js';
import { RealtimeChannel } from './channels.js';

const record = {
  subject: { kind: 'staff' as const, userId: 'u1' },
  scope: { companyId: 'c1', branchId: 'b1', channel: RealtimeChannel.QUEUE },
};

describe('InMemoryStreamTicketStore', () => {
  afterEach(() => vi.useRealTimers());

  it('issues a 64-hex random ticket with an expiry in the future', () => {
    const store = new InMemoryStreamTicketStore();
    const { ticket, expiresAt } = store.issue(record);
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(STREAM_TICKET.DEFAULT_TTL_MS);
  });

  it('never issues the same ticket twice', () => {
    const store = new InMemoryStreamTicketStore();
    const a = store.issue(record).ticket;
    const b = store.issue(record).ticket;
    expect(a).not.toBe(b);
  });

  it('consume returns the bound record — subject, scope, expiry', () => {
    const store = new InMemoryStreamTicketStore();
    const { ticket, expiresAt } = store.issue(record);
    const rec = store.consume(ticket);
    expect(rec).toEqual({ ...record, expiresAt });
  });

  it('SINGLE USE: a second consume of the same ticket returns null', () => {
    const store = new InMemoryStreamTicketStore();
    const { ticket } = store.issue(record);
    expect(store.consume(ticket)).not.toBeNull();
    expect(store.consume(ticket)).toBeNull();
    expect(store.outstanding()).toBe(0);
  });

  it('EXPIRY: an expired ticket is rejected and removed', () => {
    vi.useFakeTimers();
    const store = new InMemoryStreamTicketStore(1_000);
    const { ticket } = store.issue(record);
    vi.advanceTimersByTime(1_001);
    expect(store.consume(ticket)).toBeNull();
    expect(store.outstanding()).toBe(0);
  });

  it('rejects unknown, malformed, and empty tickets', () => {
    const store = new InMemoryStreamTicketStore();
    store.issue(record);
    expect(store.consume(undefined)).toBeNull();
    expect(store.consume('')).toBeNull();
    expect(store.consume('short')).toBeNull();
    expect(store.consume('z'.repeat(64))).toBeNull(); // right length, never issued
    // A rejected lookup must not disturb the real ticket.
    expect(store.outstanding()).toBe(1);
  });

  it('does not store the raw ticket', () => {
    const store = new InMemoryStreamTicketStore();
    const { ticket } = store.issue(record);
    const keys = [...(store as unknown as { tickets: Map<string, unknown> }).tickets.keys()];
    expect(keys).not.toContain(ticket);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('is bounded: oldest entries are evicted past MAX_OUTSTANDING', () => {
    const store = new InMemoryStreamTicketStore();
    for (let i = 0; i < STREAM_TICKET.MAX_OUTSTANDING + 100; i++) store.issue(record);
    expect(store.outstanding()).toBeLessThanOrEqual(STREAM_TICKET.MAX_OUTSTANDING);
  });

  it('sweeps expired tickets before evicting live ones when the cap is hit', () => {
    vi.useFakeTimers();
    const store = new InMemoryStreamTicketStore(1_000);
    const expiredCount = 50;
    for (let i = 0; i < expiredCount; i++) store.issue(record);
    vi.advanceTimersByTime(1_001); // those 50 are now expired but not yet swept
    // Fill exactly to the cap with live tickets, then one more to trigger the sweep.
    const live: string[] = [];
    for (let i = 0; i < STREAM_TICKET.MAX_OUTSTANDING - expiredCount + 1; i++) live.push(store.issue(record).ticket);
    expect(store.outstanding()).toBeLessThanOrEqual(STREAM_TICKET.MAX_OUTSTANDING);
    // The sweep removed expired entries, so every live ticket is still valid.
    expect(store.consume(live[0])).not.toBeNull();
    expect(store.consume(live[live.length - 1])).not.toBeNull();
  });
});
