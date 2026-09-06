import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MessageEvent } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { EVENT_BROKER, type EventBroker, type RealtimeScope } from '../../common/realtime/event-broker.js';
import {
  STREAM_TICKET_STORE,
  type StreamTicketStore,
  type StreamSubject,
} from '../../common/realtime/stream-ticket.service.js';
import type { RealtimeChannel } from '../../common/realtime/channels.js';

/** Under the ~30 s idle timeout most proxies apply; not so frequent as to matter. */
export const DEFAULT_SSE_HEARTBEAT_MS = 25_000;

@Injectable()
export class RealtimeService {
  private readonly heartbeatMs: number;

  constructor(
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
    @Inject(STREAM_TICKET_STORE) private readonly tickets: StreamTicketStore,
    config: ConfigService,
  ) {
    this.heartbeatMs = parseInt(
      config.get<string>('SSE_HEARTBEAT_MS', String(DEFAULT_SSE_HEARTBEAT_MS)),
      10,
    );
  }

  /**
   * Mint a ticket. Callers have ALREADY been authorized for `scope` by the
   * guards on their route; this only records that fact for the next 60 s.
   */
  issueTicket(subject: StreamSubject, companyId: string, branchId: string, channel: RealtimeChannel) {
    const scope: RealtimeScope = { companyId, branchId, channel };
    const { ticket, expiresAt } = this.tickets.issue({ subject, scope });
    return {
      ticket,
      expires_at: new Date(expiresAt).toISOString(),
      channel,
      branch_id: branchId,
    };
  }

  /**
   * The SSE observable for an already-authenticated scope: buffered replay
   * (if Last-Event-ID was given), live events, and a heartbeat.
   *
   * HEARTBEAT IS A COMMENT FRAME (`: heartbeat`), not a data event. Two reasons:
   *   1. Nest's SseStream auto-assigns an incrementing `id` to any non-comment
   *      message that lacks one. A data heartbeat would therefore overwrite the
   *      client's Last-Event-ID with Nest's counter instead of the broker's
   *      per-scope id, silently breaking replay on reconnect.
   *   2. Browsers' EventSource ignores comment lines completely, so the
   *      keepalive costs the client nothing and triggers no handlers.
   * Every real event carries its broker id explicitly, so Nest never invents one.
   */
  stream(scope: RealtimeScope, lastEventId?: number): Observable<MessageEvent> {
    const events = this.broker.subscribe(scope, lastEventId).pipe(
      map(
        (e): MessageEvent => ({
          id: String(e.id),
          type: e.type,
          data: { data: e.data, published_at: e.publishedAt },
        }),
      ),
    );
    const heartbeat = interval(this.heartbeatMs).pipe(
      map((): MessageEvent => ({ comment: 'heartbeat' })),
    );
    return merge(events, heartbeat);
  }

  static parseLastEventId(header: string | undefined): number | undefined {
    if (header === undefined) return undefined;
    const n = Number.parseInt(header, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
}
