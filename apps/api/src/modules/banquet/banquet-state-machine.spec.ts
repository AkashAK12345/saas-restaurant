import { describe, it, expect } from 'vitest';
import { BanquetBookingStatus, BanquetKdsStatus } from '@samco/database';
import {
  BOOKING_TRANSITIONS,
  HALL_OCCUPYING_STATUSES,
  INITIAL_BOOKING_STATUS,
  InvalidBookingTransitionError,
  InvalidKdsTransitionError,
  KDS_TRANSITIONS,
  assertBookingTransition,
  assertKdsTransition,
  canTransitionBooking,
  canTransitionKds,
  isEditable,
  isTerminalBookingStatus,
  occupiesHall,
} from './banquet-state-machine.js';

const ALL_BOOKING = Object.values(BanquetBookingStatus);
const ALL_KDS = Object.values(BanquetKdsStatus);

describe('banquet booking state machine', () => {
  it('starts as a DRAFT', () => {
    expect(INITIAL_BOOKING_STATUS).toBe(BanquetBookingStatus.DRAFT);
  });

  it.each([
    [BanquetBookingStatus.DRAFT, BanquetBookingStatus.CONFIRMED],
    [BanquetBookingStatus.DRAFT, BanquetBookingStatus.CANCELLED],
    [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED],
    [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.CANCELLED],
  ])('%s -> %s is allowed', (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(true);
    expect(() => assertBookingTransition(from, to)).not.toThrow();
  });

  it('allows exactly those four transitions and no others', () => {
    const allowed = ALL_BOOKING.flatMap((from) =>
      ALL_BOOKING.filter((to) => canTransitionBooking(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'DRAFT->CONFIRMED',
        'DRAFT->CANCELLED',
        'CONFIRMED->COMPLETED',
        'CONFIRMED->CANCELLED',
      ].sort(),
    );
  });

  it.each([
    // A draft cannot skip confirmation.
    [BanquetBookingStatus.DRAFT, BanquetBookingStatus.COMPLETED],
    // Nothing goes backwards.
    [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.DRAFT],
    [BanquetBookingStatus.COMPLETED, BanquetBookingStatus.CONFIRMED],
    [BanquetBookingStatus.COMPLETED, BanquetBookingStatus.CANCELLED],
    // A cancelled booking is never revived — that would re-claim a hall.
    [BanquetBookingStatus.CANCELLED, BanquetBookingStatus.DRAFT],
    [BanquetBookingStatus.CANCELLED, BanquetBookingStatus.CONFIRMED],
    [BanquetBookingStatus.CANCELLED, BanquetBookingStatus.COMPLETED],
  ])('%s -> %s is rejected', (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(false);
    expect(() => assertBookingTransition(from, to)).toThrow(InvalidBookingTransitionError);
  });

  it('rejects every self-transition, so a repeated operation cannot double-apply', () => {
    for (const s of ALL_BOOKING) expect(canTransitionBooking(s, s)).toBe(false);
  });

  it.each([BanquetBookingStatus.COMPLETED, BanquetBookingStatus.CANCELLED])(
    '%s is terminal',
    (s) => {
      expect(isTerminalBookingStatus(s)).toBe(true);
      expect(BOOKING_TRANSITIONS[s]).toEqual([]);
    },
  );

  it('treats an unknown status as un-transitionable rather than throwing', () => {
    expect(canTransitionBooking('NOPE' as BanquetBookingStatus, BanquetBookingStatus.CONFIRMED)).toBe(
      false,
    );
  });

  it('carries the offending pair on the error', () => {
    try {
      assertBookingTransition(BanquetBookingStatus.COMPLETED, BanquetBookingStatus.CANCELLED);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as InvalidBookingTransitionError;
      expect(err.from).toBe(BanquetBookingStatus.COMPLETED);
      expect(err.to).toBe(BanquetBookingStatus.CANCELLED);
    }
  });

  it('every status is reachable from DRAFT', () => {
    const seen = new Set([INITIAL_BOOKING_STATUS]);
    const queue = [INITIAL_BOOKING_STATUS];
    while (queue.length) {
      for (const next of BOOKING_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL_BOOKING].sort());
  });

  describe('hall occupancy', () => {
    it('is claimed by CONFIRMED and COMPLETED only', () => {
      expect([...HALL_OCCUPYING_STATUSES].sort()).toEqual(
        [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED].sort(),
      );
    });

    it('a DRAFT blocks nobody, and a CANCELLED booking releases the hall', () => {
      expect(occupiesHall(BanquetBookingStatus.DRAFT)).toBe(false);
      expect(occupiesHall(BanquetBookingStatus.CANCELLED)).toBe(false);
      expect(occupiesHall(BanquetBookingStatus.CONFIRMED)).toBe(true);
      expect(occupiesHall(BanquetBookingStatus.COMPLETED)).toBe(true);
    });

    it('matches the SQL predicate in the migration exactly', () => {
      // migration 20260907120000_phase8_banquet:
      //   WHERE ("status" IN ('CONFIRMED', 'COMPLETED'))
      const sqlPredicate = ['CONFIRMED', 'COMPLETED'];
      expect([...HALL_OCCUPYING_STATUSES].sort()).toEqual(sqlPredicate.sort());
    });
  });

  describe('editability', () => {
    it('only a draft may be edited', () => {
      expect(isEditable(BanquetBookingStatus.DRAFT)).toBe(true);
      for (const s of ALL_BOOKING.filter((x) => x !== BanquetBookingStatus.DRAFT)) {
        expect(isEditable(s)).toBe(false);
      }
    });
  });
});

describe('banquet KDS item state machine', () => {
  it.each([
    [BanquetKdsStatus.PENDING, BanquetKdsStatus.IN_PROGRESS],
    [BanquetKdsStatus.PENDING, BanquetKdsStatus.READY],
    [BanquetKdsStatus.IN_PROGRESS, BanquetKdsStatus.READY],
  ])('%s -> %s is allowed', (from, to) => {
    expect(canTransitionKds(from, to)).toBe(true);
  });

  it.each([
    // Nothing is ever un-finished on a shared kitchen screen.
    [BanquetKdsStatus.READY, BanquetKdsStatus.IN_PROGRESS],
    [BanquetKdsStatus.READY, BanquetKdsStatus.PENDING],
    [BanquetKdsStatus.IN_PROGRESS, BanquetKdsStatus.PENDING],
  ])('%s -> %s is rejected', (from, to) => {
    expect(canTransitionKds(from, to)).toBe(false);
    expect(() => assertKdsTransition(from, to)).toThrow(InvalidKdsTransitionError);
  });

  it('rejects self-transitions, so a double tap cannot double-apply', () => {
    for (const s of ALL_KDS) expect(canTransitionKds(s, s)).toBe(false);
  });

  it('READY is terminal', () => {
    expect(KDS_TRANSITIONS[BanquetKdsStatus.READY]).toEqual([]);
  });
});
