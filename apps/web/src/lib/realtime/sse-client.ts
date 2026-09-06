/**
 * Reusable SSE client for SAMCO streams.
 *
 * Works with the T0-B ticket flow: the caller supplies a `getTicket` function
 * that performs the authorized ticket request (staff: JWT → POST
 * /realtime/tickets/<channel>; display: credential header → POST
 * /display/stream-tickets). This client never sees a JWT or a device
 * credential — only the short-lived, single-use ticket, which is the one thing
 * allowed in the EventSource URL.
 *
 * Because tickets are single-use, EVERY (re)connection needs a fresh ticket.
 * Native EventSource auto-reconnect would retry the same URL, so it is
 * disabled: on error the socket is closed and this client reconnects itself
 * with exponential backoff and a new ticket. Last-Event-ID is still sent by
 * the browser automatically on those reconnects, so the server can replay.
 *
 * Domain-agnostic: subscribers register handlers by event `type` string. No
 * queue/banquet/task event shapes are defined here.
 */

export type StreamHandler = (data: unknown, event: MessageEvent) => void;
export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StreamClientOptions {
  /** Absolute URL of the stream endpoint, e.g. `${apiBase}/realtime/stream`. */
  streamUrl: string;
  /** Obtain a fresh single-use ticket. Called before every connection attempt. */
  getTicket: () => Promise<string>;
  /** Backoff bounds for reconnection. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  onStatus?: (status: StreamStatus) => void;
  /** Test seam; defaults to the global EventSource. */
  eventSourceFactory?: (url: string) => EventSource;
}

export class StreamClient {
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<StreamHandler>>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private _status: StreamStatus = 'idle';

  constructor(private readonly opts: StreamClientOptions) {}

  get status(): StreamStatus {
    return this._status;
  }

  private setStatus(s: StreamStatus): void {
    this._status = s;
    this.opts.onStatus?.(s);
  }

  /** Register a handler for a server event `type`. Returns an unsubscribe fn. */
  on(type: string, handler: StreamHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    // If already connected, attach to the live source too.
    if (this.source) this.source.addEventListener(type, this.dispatch);
    return () => {
      set!.delete(handler);
    };
  }

  private dispatch = (event: Event): void => {
    const me = event as MessageEvent;
    const set = this.handlers.get(me.type);
    if (!set) return;
    let data: unknown = me.data;
    try {
      data = JSON.parse(me.data);
    } catch {
      /* non-JSON payload, pass through */
    }
    for (const h of set) h(data, me);
  };

  async connect(): Promise<void> {
    if (this.closed) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let ticket: string;
    try {
      ticket = await this.opts.getTicket();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.closed) return;

    const url = `${this.opts.streamUrl}?ticket=${encodeURIComponent(ticket)}`;
    const factory = this.opts.eventSourceFactory ?? ((u: string) => new EventSource(u));
    const source = factory(url);
    this.source = source;

    for (const type of this.handlers.keys()) source.addEventListener(type, this.dispatch);

    source.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
    };
    source.onerror = () => {
      // Never let the browser retry the same (now consumed) ticket URL.
      source.close();
      if (this.source === source) this.source = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const min = this.opts.minBackoffMs ?? 1_000;
    const max = this.opts.maxBackoffMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** Math.min(this.attempt, 10));
    this.attempt += 1;
    this.setStatus('reconnecting');
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
    this.setStatus('closed');
  }
}
