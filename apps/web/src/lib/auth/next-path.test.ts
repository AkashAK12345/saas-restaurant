import { describe, it, expect } from 'vitest';
import { loginPathFor, safeNextPath } from './next-path';

describe('post-login redirect target', () => {
  it.each([
    ['/banquet/bk-1', '/banquet/bk-1'],
    ['/reports/queue.tokens?from=2026-03-01', '/reports/queue.tokens?from=2026-03-01'],
    ['/', '/'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['https://evil.example/phish'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['banquet'],
    ['/login'],
    ['/login?next=/login'],
    ['/tasks\n/x'],
  ])('refuses %j and goes home instead', (input) => {
    expect(safeNextPath(input)).toBe('/');
  });

  it('builds the login link that brings the visitor back', () => {
    expect(loginPathFor('/banquet/bk-1', '?tab=bill')).toBe('/login?next=%2Fbanquet%2Fbk-1%3Ftab%3Dbill');
    expect(loginPathFor('/', '')).toBe('/login');
    expect(loginPathFor('/login', '')).toBe('/login');
  });
});
