import { describe, it, expect } from 'vitest';
import { RoutineFrequency } from '@samco/database';
import {
  addDays,
  dueOccurrences,
  isTimeOfDay,
  isValidWeekday,
  nextOccurrence,
  occursOn,
  type RoutineSchedule,
} from './routine-schedule.js';

const KOLKATA = 'Asia/Kolkata'; // UTC+5:30 all year
const NEW_YORK = 'America/New_York'; // DST

const daily = (timeOfDay: string): RoutineSchedule => ({
  frequency: RoutineFrequency.DAILY,
  timeOfDay,
  weekdays: [],
});
const weekly = (timeOfDay: string, weekdays: number[]): RoutineSchedule => ({
  frequency: RoutineFrequency.WEEKLY,
  timeOfDay,
  weekdays,
});

describe('routine schedule', () => {
  describe('validation helpers', () => {
    it.each(['00:00', '09:30', '23:59'])('accepts the time %s', (t) => {
      expect(isTimeOfDay(t)).toBe(true);
    });
    it.each(['24:00', '9:30', '09:60', '0930', '', 'noon'])('rejects the time %s', (t) => {
      expect(isTimeOfDay(t)).toBe(false);
    });
    it.each([0, 3, 6])('accepts weekday %s', (d) => expect(isValidWeekday(d)).toBe(true));
    it.each([-1, 7, 1.5, '1', null])('rejects weekday %s', (d) =>
      expect(isValidWeekday(d)).toBe(false),
    );
  });

  describe('addDays', () => {
    it('walks the calendar, including across month and year ends', () => {
      expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
      expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
      expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
      expect(addDays('2028-03-01', -1)).toBe('2028-02-29'); // leap year
    });
  });

  describe('occursOn', () => {
    it('a daily routine occurs every day', () => {
      for (const d of ['2027-06-14', '2027-06-15', '2027-06-16']) {
        expect(occursOn(daily('09:00'), d, KOLKATA)).toBe(true);
      }
    });

    it('a weekly routine occurs only on its weekdays, read in branch-local time', () => {
      // 2027-06-14 is a Monday.
      const mondays = weekly('09:00', [1]);
      expect(occursOn(mondays, '2027-06-14', KOLKATA)).toBe(true);
      expect(occursOn(mondays, '2027-06-15', KOLKATA)).toBe(false);
      expect(occursOn(mondays, '2027-06-21', KOLKATA)).toBe(true);
    });

    it('supports several weekdays', () => {
      const monWedFri = weekly('09:00', [1, 3, 5]);
      expect(occursOn(monWedFri, '2027-06-14', KOLKATA)).toBe(true); // Mon
      expect(occursOn(monWedFri, '2027-06-16', KOLKATA)).toBe(true); // Wed
      expect(occursOn(monWedFri, '2027-06-17', KOLKATA)).toBe(false); // Thu
    });
  });

  describe('dueOccurrences', () => {
    it('returns nothing before the time of day has passed', () => {
      // 08:00 IST on the 15th; the routine runs at 09:00.
      const now = new Date('2027-06-15T02:30:00.000Z');
      expect(dueOccurrences(daily('09:00'), KOLKATA, now, 0)).toEqual([]);
    });

    it("returns today's occurrence once its time has passed", () => {
      // 09:30 IST on the 15th.
      const now = new Date('2027-06-15T04:00:00.000Z');
      const due = dueOccurrences(daily('09:00'), KOLKATA, now, 0);
      expect(due.map((o) => o.date)).toEqual(['2027-06-15']);
      expect(due[0].scheduledFor.toISOString()).toBe('2027-06-15T03:30:00.000Z');
    });

    it('catches up over the look-back window, oldest first', () => {
      const now = new Date('2027-06-15T04:00:00.000Z');
      const due = dueOccurrences(daily('09:00'), KOLKATA, now, 3);
      expect(due.map((o) => o.date)).toEqual([
        '2027-06-12',
        '2027-06-13',
        '2027-06-14',
        '2027-06-15',
      ]);
    });

    it('bounds the catch-up: a dormant routine does not flood the board', () => {
      const now = new Date('2027-06-15T04:00:00.000Z');
      expect(dueOccurrences(daily('09:00'), KOLKATA, now, 3)).toHaveLength(4);
      expect(dueOccurrences(daily('09:00'), KOLKATA, now, 0)).toHaveLength(1);
    });

    it('never reaches behind the day the routine was created', () => {
      // Created at 10:00 IST on the 15th. That day's 09:00 slot still counts;
      // the three days before the routine existed do not.
      const now = new Date('2027-06-15T04:30:00.000Z');
      const due = dueOccurrences(daily('09:00'), KOLKATA, now, 3, '2027-06-15');
      expect(due.map((o) => o.date)).toEqual(['2027-06-15']);
    });

    it('a routine older than its creation bound still catches up to it', () => {
      const now = new Date('2027-06-15T04:00:00.000Z');
      const due = dueOccurrences(daily('09:00'), KOLKATA, now, 3, '2027-06-13');
      expect(due.map((o) => o.date)).toEqual(['2027-06-13', '2027-06-14', '2027-06-15']);
    });

    it('skips days a weekly routine does not run on', () => {
      const now = new Date('2027-06-15T04:00:00.000Z'); // Tue 09:30 IST
      const due = dueOccurrences(weekly('09:00', [1]), KOLKATA, now, 7);
      expect(due.map((o) => o.date)).toEqual(['2027-06-14']); // the Monday only
    });

    it('uses BRANCH-local dates, not the server or UTC date', () => {
      // 20:00 UTC on the 14th is 01:30 on the 15th in Kolkata.
      const now = new Date('2027-06-14T20:00:00.000Z');
      const due = dueOccurrences(daily('01:00'), KOLKATA, now, 0);
      expect(due.map((o) => o.date)).toEqual(['2027-06-15']);
    });

    describe('DST', () => {
      it('a spring-forward day still yields exactly one occurrence', () => {
        // 14 Mar 2027, New York: 02:00 -> 03:00. A 23-hour day.
        const now = new Date('2027-03-14T20:00:00.000Z'); // 16:00 EDT
        const due = dueOccurrences(daily('09:00'), NEW_YORK, now, 0);
        expect(due).toHaveLength(1);
        expect(due[0].date).toBe('2027-03-14');
        expect(due[0].scheduledFor.toISOString()).toBe('2027-03-14T13:00:00.000Z');
      });

      it('a routine set to a SKIPPED wall-clock time still runs that day', () => {
        // 02:30 does not exist on 14 Mar in New York.
        const now = new Date('2027-03-14T20:00:00.000Z');
        const due = dueOccurrences(daily('02:30'), NEW_YORK, now, 0);
        expect(due).toHaveLength(1);
        expect(due[0].date).toBe('2027-03-14');
      });

      it('a fall-back day yields exactly one occurrence, not two', () => {
        // 7 Nov 2027, New York: 02:00 -> 01:00. A 25-hour day; 01:30 happens twice.
        const now = new Date('2027-11-07T20:00:00.000Z');
        const due = dueOccurrences(daily('01:30'), NEW_YORK, now, 0);
        expect(due).toHaveLength(1);
        expect(due[0].date).toBe('2027-11-07');
        // The first (earlier) of the two 01:30s.
        expect(due[0].scheduledFor.toISOString()).toBe('2027-11-07T05:30:00.000Z');
      });

      it('occurrence dates stay unique across a DST week', () => {
        const now = new Date('2027-11-09T20:00:00.000Z');
        const due = dueOccurrences(daily('01:30'), NEW_YORK, now, 5);
        const dates = due.map((o) => o.date);
        expect(new Set(dates).size).toBe(dates.length);
        expect(dates).toContain('2027-11-07');
      });

      it('the scheduled instant shifts with the offset, the date does not', () => {
        const winter = dueOccurrences(daily('09:00'), NEW_YORK, new Date('2027-01-20T20:00:00.000Z'), 0);
        const summer = dueOccurrences(daily('09:00'), NEW_YORK, new Date('2027-07-20T20:00:00.000Z'), 0);
        expect(winter[0].scheduledFor.toISOString()).toBe('2027-01-20T14:00:00.000Z'); // EST
        expect(summer[0].scheduledFor.toISOString()).toBe('2027-07-20T13:00:00.000Z'); // EDT
      });
    });
  });

  describe('nextOccurrence', () => {
    it('is today when the time has not yet passed', () => {
      const now = new Date('2027-06-15T02:00:00.000Z'); // 07:30 IST
      const next = nextOccurrence(daily('09:00'), KOLKATA, now);
      expect(next?.date).toBe('2027-06-15');
    });

    it('rolls to tomorrow once today has gone', () => {
      const now = new Date('2027-06-15T05:00:00.000Z'); // 10:30 IST
      expect(nextOccurrence(daily('09:00'), KOLKATA, now)?.date).toBe('2027-06-16');
    });

    it('finds the next matching weekday', () => {
      const now = new Date('2027-06-15T05:00:00.000Z'); // Tuesday
      expect(nextOccurrence(weekly('09:00', [1]), KOLKATA, now)?.date).toBe('2027-06-21');
    });

    it('returns null when nothing falls inside the horizon', () => {
      const now = new Date('2027-06-15T05:00:00.000Z');
      expect(nextOccurrence(weekly('09:00', [1]), KOLKATA, now, 2)).toBeNull();
    });
  });
});
