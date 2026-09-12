import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { NAV_ITEMS } from './nav-items';
import { ComingSoon } from './coming-soon';

/**
 * Every navigation entry must lead to a real route inside the app shell.
 *
 * Six of them once pointed at pages that had never been created, so a tap
 * fell through to the framework's bare 404 — outside the shell, with no
 * navigation and no way back. A route file is what makes a link land.
 */
const APP_DIR = resolve(process.cwd(), 'src/app/(staff)/(app)');

describe('navigation destinations', () => {
  it.each(NAV_ITEMS.map((item) => [item.label, item.href]))('%s (%s) has a page in the app shell', (_label, href) => {
    const file = resolve(APP_DIR, `.${href === '/' ? '' : href}`, 'page.tsx');
    expect(existsSync(file), file).toBe(true);
  });

  it('an unbuilt area says so honestly and offers the way home', () => {
    render(<ComingSoon href="/settings/audit" />);
    expect(screen.getByRole('heading', { name: 'Audit log' })).toBeTruthy();
    expect(screen.getByText('Audit log is not available in this version of SAMCO yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
});
