import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQueueBoard } from './use-queue-board';
import { FakeEventSource } from '@/lib/realtime/fake-event-source';
import type { QueueBoard } from './types';

const board = (waiting: number): QueueBoard => ({
  branch_id: 'br-1',
  service_date: '2026-09-07',
  next_token_number: waiting + 1,
  counts: { scheduled: 0, waiting, called: 0, seated: 0, no_show: 0, cancelled: 0 },
  totals: { parties: waiting, adults: waiting, kids: 0 },
  next_waiting: null,
  scheduled: [],
  waiting: [],
  called: [],
  seated: [],
});

const boardMock = vi.fn();
const ticketMock = vi.fn();
vi.mock('./api', () => ({
  queueApi: {
    board: (...a: unknown[]) => boardMock(...a),
    streamTicket: (...a: unknown[]) => ticketMock(...a),
  },
}));

const CTX = { companyId: 'co-1', branchId: 'br-1' };

describe('useQueueBoard', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    boardMock.mockReset().mockResolvedValue(board(1));
    ticketMock.mockReset().mockResolvedValue({ ticket: 'a'.repeat(64), expires_at: '', channel: 'queue', branch_id: 'br-1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the board and then opens a stream with a fresh ticket', async () => {
    const { result } = renderHook(() => useQueueBoard(CTX));

    await waitFor(() => expect(result.current.board).not.toBeNull());
    expect(result.current.board!.counts.waiting).toBe(1);
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    expect(ticketMock).toHaveBeenCalledTimes(1);
  });

  it('puts ONLY the ticket in the stream URL', async () => {
    renderHook(() => useQueueBoard(CTX));
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    const url = FakeEventSource.last()!.url;
    expect(url).toContain(`ticket=${'a'.repeat(64)}`);
    expect(url).not.toContain('Bearer');
    expect(url).not.toContain('co-1');
  });

  it('refetches when a queue event arrives — the event is a signal, not the truth', async () => {
    const { result } = renderHook(() => useQueueBoard(CTX));
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    expect(boardMock).toHaveBeenCalledTimes(1);

    boardMock.mockResolvedValue(board(5));
    await act(async () => {
      FakeEventSource.last()!.emit('queue.token.registered', { token_number: 2 });
      await new Promise((r) => setTimeout(r, 200));
    });

    await waitFor(() => expect(result.current.board!.counts.waiting).toBe(5));
  });

  it('coalesces a burst of events into a single refetch', async () => {
    renderHook(() => useQueueBoard(CTX));
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    boardMock.mockClear();

    await act(async () => {
      const src = FakeEventSource.last()!;
      for (let i = 0; i < 6; i++) src.emit('queue.token.called', { i });
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(boardMock).toHaveBeenCalledTimes(1);
  });

  it('resyncs when the stream reopens, because events may have been missed', async () => {
    renderHook(() => useQueueBoard(CTX));
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    boardMock.mockClear();

    await act(async () => {
      FakeEventSource.last()!.open();
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(boardMock).toHaveBeenCalledTimes(1);
  });

  it('reports a load failure without wiping a board it already has', async () => {
    const { result } = renderHook(() => useQueueBoard(CTX));
    await waitFor(() => expect(result.current.board).not.toBeNull());

    boardMock.mockRejectedValue(new Error('network down'));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe('network down');
    expect(result.current.board).not.toBeNull();
  });

  it('does nothing at all without a branch context', async () => {
    const { result } = renderHook(() => useQueueBoard(null));
    await new Promise((r) => setTimeout(r, 50));
    expect(boardMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('closes the stream when the component unmounts', async () => {
    const { unmount } = renderHook(() => useQueueBoard(CTX));
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    const src = FakeEventSource.last()!;
    unmount();
    expect(src.closed).toBe(true);
  });
});
