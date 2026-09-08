import { describe, it, expect } from 'vitest';
import { TaskStatus } from '@samco/database';
import {
  ChecklistIncompleteError,
  INITIAL_TASK_STATUS,
  InvalidTaskTransitionError,
  OPEN_TASK_STATUSES,
  TASK_TRANSITIONS,
  assertTaskTransition,
  canTransitionTask,
  isEditable,
  isOpen,
  isTerminalTaskStatus,
} from './task-state-machine.js';

const ALL = Object.values(TaskStatus);

describe('task state machine', () => {
  it('starts PENDING', () => {
    expect(INITIAL_TASK_STATUS).toBe(TaskStatus.PENDING);
  });

  it.each([
    [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
    [TaskStatus.PENDING, TaskStatus.COMPLETED],
    [TaskStatus.PENDING, TaskStatus.CANCELLED],
    [TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED],
    [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  ])('%s -> %s is allowed', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(true);
    expect(() => assertTaskTransition(from, to)).not.toThrow();
  });

  it('allows exactly those five transitions and no others', () => {
    const allowed = ALL.flatMap((from) =>
      ALL.filter((to) => canTransitionTask(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'PENDING->IN_PROGRESS',
        'PENDING->COMPLETED',
        'PENDING->CANCELLED',
        'IN_PROGRESS->COMPLETED',
        'IN_PROGRESS->CANCELLED',
      ].sort(),
    );
  });

  it.each([
    // Nothing goes backwards.
    [TaskStatus.IN_PROGRESS, TaskStatus.PENDING],
    // A completed task is never reopened or retro-cancelled.
    [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
    [TaskStatus.COMPLETED, TaskStatus.PENDING],
    [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
    // A cancelled task is never completed or restarted.
    [TaskStatus.CANCELLED, TaskStatus.COMPLETED],
    [TaskStatus.CANCELLED, TaskStatus.IN_PROGRESS],
    [TaskStatus.CANCELLED, TaskStatus.PENDING],
  ])('%s -> %s is rejected', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(false);
    expect(() => assertTaskTransition(from, to)).toThrow(InvalidTaskTransitionError);
  });

  it('rejects every self-transition, so a repeat cannot double-apply', () => {
    for (const s of ALL) expect(canTransitionTask(s, s)).toBe(false);
  });

  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELLED])('%s is terminal', (s) => {
    expect(isTerminalTaskStatus(s)).toBe(true);
    expect(TASK_TRANSITIONS[s]).toEqual([]);
  });

  it('treats an unknown status as un-transitionable rather than throwing', () => {
    expect(canTransitionTask('NOPE' as TaskStatus, TaskStatus.COMPLETED)).toBe(false);
  });

  it('carries the offending pair on the error', () => {
    try {
      assertTaskTransition(TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as InvalidTaskTransitionError;
      expect(err.from).toBe(TaskStatus.COMPLETED);
      expect(err.to).toBe(TaskStatus.IN_PROGRESS);
    }
  });

  describe('open vs finished', () => {
    it('PENDING and IN_PROGRESS are the open states', () => {
      expect([...OPEN_TASK_STATUSES].sort()).toEqual(
        [TaskStatus.PENDING, TaskStatus.IN_PROGRESS].sort(),
      );
      expect(isOpen(TaskStatus.PENDING)).toBe(true);
      expect(isOpen(TaskStatus.IN_PROGRESS)).toBe(true);
      expect(isOpen(TaskStatus.COMPLETED)).toBe(false);
      expect(isOpen(TaskStatus.CANCELLED)).toBe(false);
    });

    it('only an open task may be edited or reassigned', () => {
      expect(isEditable(TaskStatus.PENDING)).toBe(true);
      expect(isEditable(TaskStatus.IN_PROGRESS)).toBe(true);
      expect(isEditable(TaskStatus.COMPLETED)).toBe(false);
      expect(isEditable(TaskStatus.CANCELLED)).toBe(false);
    });
  });

  it('every status is reachable from PENDING', () => {
    const seen = new Set([INITIAL_TASK_STATUS]);
    const queue = [INITIAL_TASK_STATUS];
    while (queue.length) {
      for (const next of TASK_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  describe('ChecklistIncompleteError', () => {
    it('counts what is outstanding, with readable grammar', () => {
      expect(new ChecklistIncompleteError(1).message).toMatch(/1 required checklist item is/);
      expect(new ChecklistIncompleteError(3).message).toMatch(/3 required checklist items are/);
      expect(new ChecklistIncompleteError(2).outstanding).toBe(2);
    });
  });
});
