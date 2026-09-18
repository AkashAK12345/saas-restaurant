import { MONTH_SHORT } from '@/lib/format/datetime';

/** Calendar-label helpers shared by the chef display and an event's details. */

export const WEEKDAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 0 = Sunday … 6 = Saturday for a calendar label. */
export const weekday = (date: string) => new Date(`${date}T12:00:00.000Z`).getUTCDay();

export const dayNum = (date: string) => Number(date.slice(8, 10));

/** "Sep 18" */
export const shortLabel = (date: string) => `${MONTH_SHORT[Number(date.slice(5, 7)) - 1]} ${dayNum(date)}`;

/** "Friday, 18 Sep 2026" */
export const fullLabel = (date: string) =>
  `${WEEKDAY_LONG[weekday(date)]}, ${dayNum(date)} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
