import { describe, it, expect } from 'vitest';
import { QueueTokenStatus } from '@samco/database';
import {
  ACTIVE_QUEUE_STATUSES,
  INITIAL_QUEUE_STATUS,
  InvalidQueueTransitionError,
  QUEUE_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminalQueueStatus,
} from './queue-state-machine.js';

const ALL = Object.values(QueueTokenStatus);

describe('queue state machine', () => {
  it('starts at WAITING', () => {
    expect(INITIAL_QUEUE_STATUS).toBe(QueueTokenStatus.WAITING);
  });

  describe('valid transitions', () => {
    it.each([
      [QueueTokenStatus.WAITING, QueueTokenStatus.CALLED],
      [QueueTokenStatus.WAITING, QueueTokenStatus.CANCELLED],
      [QueueTokenStatus.CALLED, QueueTokenStatus.SEATED],
      [QueueTokenStatus.CALLED, QueueTokenStatus.NO_SHOW],
      [QueueTokenStatus.CALLED, QueueTokenStatus.CANCELLED],
    ])('%s -> %s is allowed', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    });

    it('allows exactly those five transitions and no others', () => {
      const allowed = ALL.flatMap((from) =>
        ALL.filter((to) => canTransition(from, to)).map((to) => `${from}->${to}`),
      );
      expect(allowed.sort()).toEqual(
        [
          'WAITING->CALLED',
          'WAITING->CANCELLED',
          'CALLED->SEATED',
          'CALLED->NO_SHOW',
          'CALLED->CANCELLED',
        ].sort(),
      );
    });
  });

  describe('invalid transitions', () => {
    it.each([
      // Skipping CALLED entirely — a party cannot be seated straight off the list.
      [QueueTokenStatus.WAITING, QueueTokenStatus.SEATED],
      [QueueTokenStatus.WAITING, QueueTokenStatus.NO_SHOW],
      // No recall: the model has no CALLED -> WAITING edge (see the module doc).
      [QueueTokenStatus.CALLED, QueueTokenStatus.WAITING],
      // Nothing leaves a terminal state.
      [QueueTokenStatus.SEATED, QueueTokenStatus.CALLED],
      [QueueTokenStatus.SEATED, QueueTokenStatus.CANCELLED],
      [QueueTokenStatus.NO_SHOW, QueueTokenStatus.CALLED],
      [QueueTokenStatus.NO_SHOW, QueueTokenStatus.SEATED],
      [QueueTokenStatus.CANCELLED, QueueTokenStatus.WAITING],
      [QueueTokenStatus.CANCELLED, QueueTokenStatus.CALLED],
    ])('%s -> %s is rejected', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(InvalidQueueTransitionError);
    });

    it('rejects every self-transition, so a repeated operation cannot double-apply', () => {
      for (const status of ALL) {
        expect(canTransition(status, status)).toBe(false);
      }
    });

    it('rejects a repeated transition once it has been applied', () => {
      // WAITING -> CALLED succeeds; calling the same token again starts from
      // CALLED, where CALLED is no longer a legal destination.
      expect(canTransition(QueueTokenStatus.WAITING, QueueTokenStatus.CALLED)).toBe(true);
      expect(canTransition(QueueTokenStatus.CALLED, QueueTokenStatus.CALLED)).toBe(false);
    });

    it('carries the offending pair on the error', () => {
      try {
        assertTransition(QueueTokenStatus.SEATED, QueueTokenStatus.CALLED);
        expect.unreachable('should have thrown');
      } catch (e) {
        const err = e as InvalidQueueTransitionError;
        expect(err.from).toBe(QueueTokenStatus.SEATED);
        expect(err.to).toBe(QueueTokenStatus.CALLED);
        expect(err.message).toContain('SEATED');
        expect(err.message).toContain('CALLED');
      }
    });

    it('treats an unknown status as un-transitionable rather than throwing', () => {
      expect(canTransition('NOPE' as QueueTokenStatus, QueueTokenStatus.CALLED)).toBe(false);
    });
  });

  describe('terminal states', () => {
    it.each([QueueTokenStatus.SEATED, QueueTokenStatus.NO_SHOW, QueueTokenStatus.CANCELLED])(
      '%s is terminal',
      (status) => {
        expect(isTerminalQueueStatus(status)).toBe(true);
        expect(QUEUE_TRANSITIONS[status]).toEqual([]);
      },
    );

    it.each([QueueTokenStatus.WAITING, QueueTokenStatus.CALLED])('%s is not terminal', (status) => {
      expect(isTerminalQueueStatus(status)).toBe(false);
    });

    it('lists WAITING and CALLED as the active statuses', () => {
      expect([...ACTIVE_QUEUE_STATUSES].sort()).toEqual(
        [QueueTokenStatus.CALLED, QueueTokenStatus.WAITING].sort(),
      );
      for (const status of ACTIVE_QUEUE_STATUSES) {
        expect(isTerminalQueueStatus(status)).toBe(false);
      }
    });
  });

  it('every status is reachable from WAITING', () => {
    const seen = new Set<QueueTokenStatus>([INITIAL_QUEUE_STATUS]);
    const queue: QueueTokenStatus[] = [INITIAL_QUEUE_STATUS];
    while (queue.length) {
      for (const next of QUEUE_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });
});
