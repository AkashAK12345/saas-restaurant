import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * jsdom does no layout, so the one rule that keeps the shell from widening a
 * phone is guarded here at the stylesheet itself.
 *
 * Both of the shell's full-width grid items can hold content wider than a
 * phone: `.content` a report table, `.bottomnav` a manager's eleven nav links
 * (~680px). A grid item defaults to `min-width: auto`, so either would stretch
 * the single column and make the entire app zoom out or scroll sideways on a
 * 375px screen. Each must stay pinned to `min-width: 0` so the wide thing
 * scrolls inside its own box instead.
 */
// Vitest runs from apps/web; import.meta.url is not a file: URL under jsdom.
const css = readFileSync(resolve(process.cwd(), 'src/components/shell/app-shell.module.css'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Top-level rules only: the selector must start a line, so the indented copy
  // inside the desktop media query is not what gets checked.
  const match = css.match(new RegExp(String.raw`(?:^|\n)` + escaped + String.raw`\s*\{([^}]*)\}`));
  if (!match) throw new Error(`no top-level rule for ${selector}`);
  return match[1];
}

describe('app shell layout on narrow screens', () => {
  it.each(['.content', '.bottomnav'])('%s cannot be stretched by its content', (selector) => {
    expect(rule(selector)).toMatch(/(^|;|\s)min-width:\s*0\s*;/);
  });
});
