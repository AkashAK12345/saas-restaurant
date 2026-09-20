import { BadRequestException } from '@nestjs/common';

export type ChecklistItemKindName =
  | 'CHECK'
  | 'NUMBER'
  | 'TEXT'
  | 'RATING'
  | 'DATE'
  | 'TIME'
  | 'PHOTO'
  | 'YES_NO';

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const TEXT_MAX = 1000;

/**
 * Turn an operator's answer into the one canonical text form stored for it,
 * or refuse it. Values are stored as text on purpose: a meter reading of
 * "1234.50" must come back exactly as entered, which a float cannot promise,
 * and one column serves every kind without a table per type.
 *
 *   NUMBER  up to 12 integer digits and 3 decimals, optional minus
 *   RATING  a whole number 1–5
 *   DATE    a real calendar date, YYYY-MM-DD
 *   TIME    a 24-hour wall clock, HH:MM
 *   TEXT    1–1000 characters after trimming
 *   YES_NO  "YES" or "NO" (any case), stored upper-case
 *   CHECK   takes no value at all
 *   PHOTO   takes no value at all — its state comes from the item-photo
 *           endpoints (see TaskChecklistItemPhoto), never this PATCH
 */
export function normalizeChecklistValue(kind: ChecklistItemKindName, raw: unknown): string {
  if (kind === 'CHECK' || kind === 'PHOTO') {
    throw new BadRequestException(`A ${kind === 'CHECK' ? 'tick' : 'photo'} item takes no value here`);
  }
  if (typeof raw !== 'string') {
    throw new BadRequestException('This item needs an answer');
  }
  const value = raw.trim();
  switch (kind) {
    case 'NUMBER': {
      if (!/^-?\d{1,12}(\.\d{1,3})?$/.test(value)) {
        throw new BadRequestException('Enter a number, e.g. 12 or 12.5 (up to 3 decimals)');
      }
      // Canonical: no redundant leading zeros, no trailing decimal zeros.
      const [intPart, frac = ''] = value.replace(/^-/, '').split('.');
      const sign = value.startsWith('-') ? '-' : '';
      const intCanonical = intPart.replace(/^0+(?=\d)/, '');
      const fracCanonical = frac.replace(/0+$/, '');
      const out = `${sign}${intCanonical}${fracCanonical ? `.${fracCanonical}` : ''}`;
      return out === '-0' ? '0' : out;
    }
    case 'RATING': {
      if (!/^\d$/.test(value) || Number(value) < RATING_MIN || Number(value) > RATING_MAX) {
        throw new BadRequestException(`Choose a rating from ${RATING_MIN} to ${RATING_MAX}`);
      }
      return value;
    }
    case 'DATE': {
      const d = new Date(`${value}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException('Enter a real date as YYYY-MM-DD');
      }
      return value;
    }
    case 'TIME': {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new BadRequestException('Enter a 24-hour time as HH:MM');
      }
      return value;
    }
    case 'TEXT': {
      if (value.length === 0) throw new BadRequestException('This item needs an answer');
      if (value.length > TEXT_MAX) throw new BadRequestException(`Keep the answer under ${TEXT_MAX} characters`);
      return value;
    }
    case 'YES_NO': {
      const answer = value.toUpperCase();
      if (answer !== 'YES' && answer !== 'NO') throw new BadRequestException('Answer Yes or No');
      return answer;
    }
  }
}
