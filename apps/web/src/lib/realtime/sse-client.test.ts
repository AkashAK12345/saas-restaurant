import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamClient } from './sse-client';

/** Minimal controllable EventSource double. */
class FakeSource {
  static instances: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, Set<(e: Event) => void>>();
  constructor(public url: string) {
    FakeSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    const ev = new MessageEvent(type, { data });
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

describe('StreamClient', () => {
  beforeEach(() => {
    FakeSource.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  function make(getTicket = vi.fn(async () => 'ticket-1')) {
    const statuses: string[] = [];
    const client = new StreamClient({
      streamUrl: 'http://api/api/v1/realtime/stream',
      getTicket,
      minBackoffMs: 100,
      maxBackoffMs: 1000,
      onStatus: (s) => statuses.push(s),
      eventSourceFactory: (u) => new FakeSource(u) as unknown as EventSource,
    });
    return { client, getTicket, statuses };
  }

  it('fetches a ticket and connects with ONLY the ticket in the URL', async () => {
    const { client, getTicket } = make();
    await client.connect();
    expect(getTicket).toHaveBeenCalledTimes(1);
    expect(FakeSource.instances[0].url).toBe('http://api/api/v1/realtime/stream?ticket=ticket-1');
  });

  it('dispatches events by type and parses JSON payloads', async () => {
    const { client } = make();
    const handler = vi.fn();
    client.on('token.called', handler);
    await client.connect();
    FakeSource.instances[0].emit('token.called', JSON.stringify({ data: { n: 7 } }));
    expect(handler).toHaveBeenCalledWith({ data: { n: 7 } }, expect.any(MessageEvent));
  });

  it('on error: closes the socket and reconnects with a FRESH ticket (never reuses one)', async () => {
    const tickets = ['t1', 't2'];
    const getTicket = vi.fn(async () => tickets.shift()!);
    const { client, statuses } = make(getTicket);
    await client.connect();
    FakeSource.instances[0].onopen?.();
    expect(client.status).toBe('open');

    FakeSource.instances[0].onerror?.();
    expect(FakeSource.instances[0].closed).toBe(true);
    expect(client.status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(100);
    expect(getTicket).toHaveBeenCalledTimes(2);
    expect(FakeSource.instances[1].url).toContain('ticket=t2');
    expect(FakeSource.instances[1].url).not.toContain('t1');
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'reconnecting']);
  });

  it('backs off exponentially up to the max', async () => {
    const getTicket = vi.fn(async () => 'x');
    const { client } = make(getTicket);
    await client.connect();
    // Repeated failures: 100, 200, 400, 800, 1000 (capped)
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = getTicket.mock.calls.length;
      FakeSource.instances[FakeSource.instances.length - 1].onerror?.();
      let waited = 0;
      while (getTicket.mock.calls.length === before && waited < 5000) {
        await vi.advanceTimersByTimeAsync(50);
        waited += 50;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([100, 200, 400, 800, 1000]);
  });

  it('a failing ticket fetch schedules a retry instead of throwing', async () => {
    const getTicket = vi.fn().mockRejectedValueOnce(new Error('403')).mockResolvedValue('ok');
    const { client } = make(getTicket);
    await client.connect();
    expect(FakeSource.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSource.instances).toHaveLength(1);
  });

  it('close() stops everything and prevents further reconnects', async () => {
    const { client, getTicket } = make();
    await client.connect();
    client.close();
    expect(FakeSource.instances[0].closed).toBe(true);
    FakeSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getTicket).toHaveBeenCalledTimes(1);
    expect(client.status).toBe('closed');
  });

  it('is domain-agnostic: handlers are keyed by arbitrary type strings', async () => {
    const { client } = make();
    const a = vi.fn();
    const b = vi.fn();
    client.on('anything.at.all', a);
    const off = client.on('other', b);
    off();
    await client.connect();
    FakeSource.instances[0].emit('anything.at.all', 'plain text');
    FakeSource.instances[0].emit('other', '1');
    expect(a).toHaveBeenCalledWith('plain text', expect.any(MessageEvent));
    expect(b).not.toHaveBeenCalled();
  });
});
