import { describe, it, expect } from 'vitest';
import { QueueTokenStatus } from '@samco/database';
import {
  ACTIVE_QUEUE_STATUSES,
  INITIAL_QUEUE_STATUS,
  INITIAL_SCHEDULED_STATUS,
  InvalidQueueTransitionError,
  QUEUE_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminalQueueStatus,
} from './queue-state-machine.js';

const ALL = Object.values(QueueTokenStatus);

describe('queue state machine', () => {
  it('a walk-in starts WAITING; an advance booking starts SCHEDULED', () => {
    expect(INITIAL_QUEUE_STATUS).toBe(QueueTokenStatus.WAITING);
    expect(INITIAL_SCHEDULED_STATUS).toBe(QueueTokenStatus.SCHEDULED);
  });

  describe('valid transitions', () => {
    it.each([
      [QueueTokenStatus.SCHEDULED, QueueTokenStatus.WAITING], // check-in / activation
      [QueueTokenStatus.SCHEDULED, QueueTokenStatus.CANCELLED],
      [QueueTokenStatus.WAITING, QueueTokenStatus.CALLED],
      [QueueTokenStatus.WAITING, QueueTokenStatus.CANCELLED],
      [QueueTokenStatus.CALLED, QueueTokenStatus.SEATED],
      [QueueTokenStatus.CALLED, QueueTokenStatus.NO_SHOW],
      [QueueTokenStatus.CALLED, QueueTokenStatus.CANCELLED],
      [QueueTokenStatus.CALLED, QueueTokenStatus.WAITING], // skip
    ])('%s -> %s is allowed', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    });

    it('allows exactly those eight transitions and no others', () => {
      const allowed = ALL.flatMap((from) =>
        ALL.filter((to) => canTransition(from, to)).map((to) => `${from}->${to}`),
      );
      expect(allowed.sort()).toEqual(
        [
          'SCHEDULED->WAITING',
          'SCHEDULED->CANCELLED',
          'WAITING->CALLED',
          'WAITING->CANCELLED',
          'CALLED->SEATED',
          'CALLED->NO_SHOW',
          'CALLED->CANCELLED',
          'CALLED->WAITING',
        ].sort(),
      );
    });
  });

  describe('invalid transitions', () => {
    it.each([
      // Skipping CALLED entirely — a party cannot be seated straight off the list.
      [QueueTokenStatus.WAITING, QueueTokenStatus.SEATED],
      [QueueTokenStatus.WAITING, QueueTokenStatus.NO_SHOW],
      // A live party is never pushed back into the future.
      [QueueTokenStatus.WAITING, QueueTokenStatus.SCHEDULED],
      [QueueTokenStatus.CALLED, QueueTokenStatus.SCHEDULED],
      // A scheduled party must surface before it can be called or seated.
      [QueueTokenStatus.SCHEDULED, QueueTokenStatus.CALLED],
      [QueueTokenStatus.SCHEDULED, QueueTokenStatus.SEATED],
      [QueueTokenStatus.SCHEDULED, QueueTokenStatus.NO_SHOW],
      // Nothing leaves a terminal state.
      [QueueTokenStatus.SEATED, QueueTokenStatus.CALLED],
      [QueueTokenStatus.SEATED, QueueTokenStatus.WAITING],
      [QueueTokenStatus.SEATED, QueueTokenStatus.CANCELLED],
      [QueueTokenStatus.NO_SHOW, QueueTokenStatus.CALLED],
      [QueueTokenStatus.NO_SHOW, QueueTokenStatus.WAITING],
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

    it.each([QueueTokenStatus.SCHEDULED, QueueTokenStatus.WAITING, QueueTokenStatus.CALLED])(
      '%s is not terminal',
      (status) => {
        expect(isTerminalQueueStatus(status)).toBe(false);
      },
    );

    it('lists WAITING and CALLED as the statuses holding a place in the live queue', () => {
      expect([...ACTIVE_QUEUE_STATUSES].sort()).toEqual(
        [QueueTokenStatus.CALLED, QueueTokenStatus.WAITING].sort(),
      );
    });
  });

  const reachableFrom = (start: QueueTokenStatus) => {
    const seen = new Set<QueueTokenStatus>([start]);
    const queue: QueueTokenStatus[] = [start];
    while (queue.length) {
      for (const next of QUEUE_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return [...seen].sort();
  };

  it('every status is reachable from an advance booking', () => {
    expect(reachableFrom(QueueTokenStatus.SCHEDULED)).toEqual([...ALL].sort());
  });

  it('a walk-in reaches everything except being scheduled', () => {
    expect(reachableFrom(QueueTokenStatus.WAITING)).toEqual(
      ALL.filter((s) => s !== QueueTokenStatus.SCHEDULED).sort(),
    );
  });
});
