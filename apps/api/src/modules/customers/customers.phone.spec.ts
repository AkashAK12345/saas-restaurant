import { describe, it, expect } from 'vitest';
import { normalizePhone } from './customers.phone.js';

/**
 * The stored value feeds the (company_id, phone) unique index, so every way a
 * human might type the same number must collapse to one string.
 */
describe('normalizePhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['(0141) 234-5678', '01412345678'],
    ['  +44 20 7946 0958  ', '+442079460958'],
    ['+1.212.555.0100', '+12125550100'],
    ['00919876543210', '+919876543210'], // international 00 prefix → +
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('treats the same number typed differently as identical', () => {
    const forms = ['+91 98765 43210', '+91-98765-43210', '+919876543210', '0091 98765 43210'];
    const normalized = new Set(forms.map(normalizePhone));
    expect(normalized.size).toBe(1);
  });

  it.each([
    [''],
    ['   '],
    ['12345'], // too short
    ['1234567890123456'], // 16 digits, over E.164 max
    ['+'],
    ['abc'],
    ['98765abc43210'],
    ['+91 98765 43210 ext 5'],
    ['++919876543210'],
    ['9876 543 21+0'], // + not leading
  ])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('does not infer a country code — with and without + are different values', () => {
    expect(normalizePhone('919876543210')).toBe('919876543210');
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).not.toBe(normalizePhone('+919876543210'));
  });
});
