import { describe, it, expect, beforeEach } from 'vitest';
import { InProcessEventBroker, REPLAY_BUFFER_SIZE, scopeKey, type RealtimeEvent, type RealtimeScope } from './event-broker.js';
import { RealtimeChannel } from './channels.js';

const A1: RealtimeScope = { companyId: 'coA', branchId: 'br1', channel: RealtimeChannel.QUEUE };
const A2: RealtimeScope = { companyId: 'coA', branchId: 'br2', channel: RealtimeChannel.QUEUE };
const B1: RealtimeScope = { companyId: 'coB', branchId: 'br1', channel: RealtimeChannel.QUEUE };
const A1_KDS: RealtimeScope = { companyId: 'coA', branchId: 'br1', channel: RealtimeChannel.BANQUET_KDS };

function collect(broker: InProcessEventBroker, scope: RealtimeScope, after?: number) {
  const got: RealtimeEvent[] = [];
  const sub = broker.subscribe(scope, after).subscribe((e) => got.push(e));
  return { got, unsubscribe: () => sub.unsubscribe() };
}

describe('InProcessEventBroker', () => {
  let broker: InProcessEventBroker;
  beforeEach(() => {
    broker = new InProcessEventBroker();
  });

  it('delivers a published event to a live subscriber of the same scope', () => {
    const s = collect(broker, A1);
    broker.publish(A1, 'thing.happened', { n: 1 });
    expect(s.got).toHaveLength(1);
    expect(s.got[0]).toMatchObject({ id: 1, type: 'thing.happened', data: { n: 1 } });
    s.unsubscribe();
  });

  it('SCOPE ISOLATION: same company / other branch never receives', () => {
    const a1 = collect(broker, A1);
    const a2 = collect(broker, A2);
    broker.publish(A1, 'x', 1);
    expect(a1.got).toHaveLength(1);
    expect(a2.got).toHaveLength(0);
    a1.unsubscribe(); a2.unsubscribe();
  });

  it('SCOPE ISOLATION: other company / same branch id never receives', () => {
    // Branch ids are UUIDs and unique in practice, but the broker must not
    // rely on that: company is part of the key.
    const a1 = collect(broker, A1);
    const b1 = collect(broker, B1);
    broker.publish(A1, 'x', 1);
    broker.publish(B1, 'y', 2);
    expect(a1.got.map((e) => e.type)).toEqual(['x']);
    expect(b1.got.map((e) => e.type)).toEqual(['y']);
    a1.unsubscribe(); b1.unsubscribe();
  });

  it('SCOPE ISOLATION: same company+branch, different channel, never receives', () => {
    const q = collect(broker, A1);
    const k = collect(broker, A1_KDS);
    broker.publish(A1, 'queue.ev', 1);
    expect(q.got).toHaveLength(1);
    expect(k.got).toHaveLength(0);
    q.unsubscribe(); k.unsubscribe();
  });

  it('ids are monotonic PER SCOPE, not global', () => {
    broker.publish(A1, 'a', 1);
    broker.publish(A1, 'a', 2);
    const b = broker.publish(B1, 'b', 1);
    const a3 = broker.publish(A1, 'a', 3);
    expect(b.id).toBe(1);
    expect(a3.id).toBe(3);
  });

  it('replays buffered events after a given id, scoped to that key only', () => {
    broker.publish(A1, 'a', 1); // id 1
    broker.publish(A1, 'a', 2); // id 2
    broker.publish(A1, 'a', 3); // id 3
    broker.publish(B1, 'b', 1); // B1 id 1 — must not leak into A1's replay

    const s = collect(broker, A1, 1);
    expect(s.got.map((e) => e.id)).toEqual([2, 3]);
    expect(s.got.every((e) => e.type === 'a')).toBe(true);
    s.unsubscribe();
  });

  it('a Last-Event-ID beyond what exists replays nothing and still gets live events', () => {
    broker.publish(A1, 'a', 1);
    const s = collect(broker, A1, 999);
    expect(s.got).toHaveLength(0);
    broker.publish(A1, 'a', 2);
    expect(s.got.map((e) => e.id)).toEqual([2]);
    s.unsubscribe();
  });

  it('replay buffer is bounded', () => {
    for (let i = 0; i < REPLAY_BUFFER_SIZE + 50; i++) broker.publish(A1, 'a', i);
    const s = collect(broker, A1, 0);
    expect(s.got).toHaveLength(REPLAY_BUFFER_SIZE);
    expect(s.got[0].id).toBe(51); // the oldest 50 were evicted
    s.unsubscribe();
  });

  it('tracks live subscribers and releases them on unsubscribe', () => {
    expect(broker.subscriberCount(A1)).toBe(0);
    const a = collect(broker, A1);
    const b = collect(broker, A1);
    expect(broker.subscriberCount(A1)).toBe(2);
    a.unsubscribe();
    expect(broker.subscriberCount(A1)).toBe(1);
    b.unsubscribe();
    expect(broker.subscriberCount(A1)).toBe(0);
    // Counting is per scope
    expect(broker.subscriberCount(B1)).toBe(0);
  });

  it('publishing with no subscribers does not throw and is still buffered', () => {
    expect(() => broker.publish(A2, 'quiet', null)).not.toThrow();
    const s = collect(broker, A2, 0);
    expect(s.got).toHaveLength(1);
    s.unsubscribe();
  });

  it('scopeKey includes all three dimensions', () => {
    expect(scopeKey(A1)).toBe('coA|br1|queue');
    expect(new Set([A1, A2, B1, A1_KDS].map(scopeKey)).size).toBe(4);
  });
});
