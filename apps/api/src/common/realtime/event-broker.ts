import { Injectable } from '@nestjs/common';
import { Observable, Subject, concat, defer, from } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { RealtimeChannel } from './channels.js';

/**
 * Every event lives in exactly one (company, branch, channel) scope. The scope
 * is always derived server-side — from the guard-verified staff context or the
 * authenticated DisplayDevice row — never from anything a client sends.
 */
export interface RealtimeScope {
  companyId: string;
  branchId: string;
  channel: RealtimeChannel;
}

export interface RealtimeEvent {
  /** Monotonic per scope. Used for Last-Event-ID replay. */
  id: number;
  /** Domain-chosen event type, e.g. "token.called". Not defined here. */
  type: string;
  data: unknown;
  publishedAt: string;
}

/**
 * The broker contract domain modules code against.
 *
 * PUBLISH TIMING — the one rule every future caller must follow:
 *
 *   publish() AFTER the database transaction has committed, never inside it.
 *
 *   const result = await this.prisma.$transaction(async (tx) => { ... });
 *   this.broker.publish(scope, 'token.called', result);   // ← after commit
 *
 * Publishing inside the transaction would let subscribers see state that may
 * still roll back. The broker is synchronous and cannot know about your
 * transaction, so this is a discipline, not something it can enforce.
 *
 * REPLACEABILITY: this is an interface behind an injection token so a shared
 * implementation (e.g. Redis pub/sub for multi-instance fan-out) is a provider
 * swap in RealtimeCoreModule. Domain modules never import the concrete class.
 */
export interface EventBroker {
  publish(scope: RealtimeScope, type: string, data: unknown): RealtimeEvent;
  /**
   * Live events for the scope. When `afterEventId` is given, buffered events
   * with a greater id are replayed first (see replay notes on the in-process
   * implementation).
   */
  subscribe(scope: RealtimeScope, afterEventId?: number): Observable<RealtimeEvent>;
  /** Live subscriber count for a scope — used by tests and diagnostics. */
  subscriberCount(scope: RealtimeScope): number;
}

export const EVENT_BROKER = Symbol('EVENT_BROKER');

export function scopeKey(scope: RealtimeScope): string {
  return `${scope.companyId}|${scope.branchId}|${scope.channel}`;
}

interface Topic {
  subject: Subject<RealtimeEvent>;
  nextId: number;
  buffer: RealtimeEvent[];
  subscribers: number;
}

/** Events retained per scope for Last-Event-ID reconnection. */
export const REPLAY_BUFFER_SIZE = 200;

/**
 * In-process broker.
 *
 * SINGLE-INSTANCE: state lives in this process. A second API replica has its
 * own broker and its own subscribers, so an event published on one replica
 * does not reach clients connected to another. Acceptable for the current
 * single-instance deployment; a shared broker is BACKLOG.
 *
 * REPLAY BUFFER: the last REPLAY_BUFFER_SIZE events per scope are kept in
 * memory so a reconnecting client can resume from Last-Event-ID. It is NOT
 * durable — a process restart empties it, ids restart from 1, and a client
 * presenting an old id simply receives no replay. Because the buffer is keyed
 * by the server-derived scope, a Last-Event-ID can only ever replay events
 * from the scope the caller is already authorized for; it cannot be used to
 * reach into another company's or branch's buffer.
 */
@Injectable()
export class InProcessEventBroker implements EventBroker {
  private readonly topics = new Map<string, Topic>();

  private topic(scope: RealtimeScope): Topic {
    const key = scopeKey(scope);
    let t = this.topics.get(key);
    if (!t) {
      t = { subject: new Subject<RealtimeEvent>(), nextId: 1, buffer: [], subscribers: 0 };
      this.topics.set(key, t);
    }
    return t;
  }

  publish(scope: RealtimeScope, type: string, data: unknown): RealtimeEvent {
    const t = this.topic(scope);
    const event: RealtimeEvent = {
      id: t.nextId++,
      type,
      data,
      publishedAt: new Date().toISOString(),
    };
    t.buffer.push(event);
    if (t.buffer.length > REPLAY_BUFFER_SIZE) t.buffer.shift();
    t.subject.next(event);
    return event;
  }

  subscribe(scope: RealtimeScope, afterEventId?: number): Observable<RealtimeEvent> {
    const t = this.topic(scope);
    return defer(() => {
      t.subscribers += 1;
      const replay =
        afterEventId !== undefined && Number.isFinite(afterEventId)
          ? t.buffer.filter((e) => e.id > afterEventId)
          : [];
      return concat(from(replay), t.subject.asObservable()).pipe(
        finalize(() => {
          t.subscribers -= 1;
        }),
      );
    });
  }

  subscriberCount(scope: RealtimeScope): number {
    return this.topics.get(scopeKey(scope))?.subscribers ?? 0;
  }
}
