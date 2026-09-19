import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { normalizeChecklistValue } from './checklist-values.js';

describe('checklist answers', () => {
  it.each([
    ['12', '12'],
    ['0012.50', '12.5'],
    ['1234.500', '1234.5'],
    ['-3', '-3'],
    ['-0.000', '0'],
    [' 7.125 ', '7.125'],
  ])('keeps the number %j exactly as %j', (raw, expected) => {
    expect(normalizeChecklistValue('NUMBER', raw)).toBe(expected);
  });

  it.each([['12.3456'], ['1e3'], ['abc'], [''], ['1,000'], ['NaN'], ['1234567890123']])(
    'refuses the number %j',
    (raw) => {
      expect(() => normalizeChecklistValue('NUMBER', raw)).toThrow(BadRequestException);
    },
  );

  it('accepts ratings 1 to 5 only', () => {
    expect(normalizeChecklistValue('RATING', '5')).toBe('5');
    for (const bad of ['0', '6', '4.5', 'five', '']) {
      expect(() => normalizeChecklistValue('RATING', bad)).toThrow(BadRequestException);
    }
  });

  it('accepts only real calendar dates', () => {
    expect(normalizeChecklistValue('DATE', '2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2026-02-30', '15/09/2026', '2026-9-1', '']) {
      expect(() => normalizeChecklistValue('DATE', bad)).toThrow(BadRequestException);
    }
  });

  it('trims text and bounds its length', () => {
    expect(normalizeChecklistValue('TEXT', '  Gas leak smell near tandoor  ')).toBe('Gas leak smell near tandoor');
    expect(() => normalizeChecklistValue('TEXT', '   ')).toThrow(BadRequestException);
    expect(() => normalizeChecklistValue('TEXT', 'x'.repeat(1001))).toThrow(BadRequestException);
  });

  it('refuses any value on a tick item, and a non-string answer anywhere', () => {
    expect(() => normalizeChecklistValue('CHECK', 'yes')).toThrow(BadRequestException);
    expect(() => normalizeChecklistValue('NUMBER', 12 as unknown as string)).toThrow(BadRequestException);
    expect(() => normalizeChecklistValue('TEXT', null)).toThrow(BadRequestException);
  });

  it('takes Yes or No on a yes/no item, in any case, stored upper-case', () => {
    expect(normalizeChecklistValue('YES_NO', 'yes')).toBe('YES');
    expect(normalizeChecklistValue('YES_NO', ' No ')).toBe('NO');
    for (const bad of ['', 'maybe', 'Y', 'true']) {
      expect(() => normalizeChecklistValue('YES_NO', bad)).toThrow(BadRequestException);
    }
  });

  it('refuses any value on a photo item too — its state comes from the item-photo endpoints', () => {
    expect(() => normalizeChecklistValue('PHOTO', 'anything')).toThrow(BadRequestException);
    expect(() => normalizeChecklistValue('PHOTO', undefined)).toThrow(BadRequestException);
  });
});
