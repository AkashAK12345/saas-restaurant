/**
 * Minimal EventSource stand-in for tests.
 *
 * jsdom has no EventSource, and the real one would open a network connection.
 * This records the URLs it was constructed with (so tests can assert that only
 * a single-use ticket ever appears there) and lets a test emit named events.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset(): void {
    FakeEventSource.instances = [];
  }
  static last(): FakeEventSource | undefined {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: (e: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: pretend the server accepted the connection. */
  open(): void {
    this.onopen?.();
  }

  /** Test helper: deliver a named server event. */
  emit(type: string, data: unknown): void {
    const event = { type, data: JSON.stringify(data) } as MessageEvent;
    for (const h of this.listeners.get(type) ?? []) h(event);
  }

  /** Test helper: drop the connection. */
  fail(): void {
    this.onerror?.();
  }
}
