import { describe, it, expect } from 'vitest';
import {
  InvalidPlateTransitionError,
  PLATE_REQUEST_STATUSES,
  PLATE_TRANSITIONS,
  assertPlateTransition,
  canTransitionPlate,
} from './banquet-state-machine.js';

describe('plate request lifecycle', () => {
  it('allows exactly request → approve → dispatch, and request → reject', () => {
    const legal: string[] = [];
    for (const from of PLATE_REQUEST_STATUSES) {
      for (const to of PLATE_REQUEST_STATUSES) {
        if (canTransitionPlate(from, to)) legal.push(`${from}->${to}`);
      }
    }
    expect(legal.sort()).toEqual(['APPROVED->DISPATCHED', 'REQUESTED->APPROVED', 'REQUESTED->REJECTED']);
  });

  it('never moves backwards, and rejected or dispatched is final', () => {
    expect(PLATE_TRANSITIONS.REJECTED).toEqual([]);
    expect(PLATE_TRANSITIONS.DISPATCHED).toEqual([]);
    expect(canTransitionPlate('APPROVED', 'REQUESTED')).toBe(false);
    expect(canTransitionPlate('APPROVED', 'REJECTED')).toBe(false);
  });

  it('cannot dispatch plates nobody approved', () => {
    expect(() => assertPlateTransition('REQUESTED', 'DISPATCHED')).toThrow(InvalidPlateTransitionError);
    expect(() => assertPlateTransition('REQUESTED', 'DISPATCHED')).toThrow(
      'Cannot move a plate request from REQUESTED to DISPATCHED',
    );
  });
});
