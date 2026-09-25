import type { ReactNode } from 'react';

/**
 * Navigation glyphs.
 *
 * Inline SVG rather than an icon package: the set is small, it costs no
 * dependency and no network request, and it inherits `currentColor` so a tile's
 * accent drives the glyph without a second source of truth.
 *
 * Every icon is `aria-hidden` — the visible label beside it already names the
 * destination, so announcing the glyph too would just make a screen reader say
 * everything twice.
 */
export type NavIconName =
  | 'home'
  | 'dashboard'
  | 'settings'
  | 'customers'
  | 'tables'
  | 'queue'
  | 'banquet'
  | 'tasks'
  | 'reports'
  | 'inventory'
  | 'displays'
  | 'users'
  | 'roles'
  | 'audit';

const PATHS: Record<NavIconName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.4c1.9.6 3 2.2 3 4.6" />
    </>
  ),
  tables: (
    <>
      <path d="M3 9h18" />
      <path d="M5 9V6.5h14V9" />
      <path d="M7.5 9v9" />
      <path d="M16.5 9v9" />
    </>
  ),
  queue: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M2.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15 19c0-2.4 1.4-4 3.5-4 1.6 0 3 1 3 3" />
    </>
  ),
  banquet: (
    <>
      <path d="M4 21V6l8-3 8 3v15" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 10h.01M15 10h.01" />
    </>
  ),
  tasks: (
    <>
      <path d="M9 5h11" />
      <path d="M9 12h11" />
      <path d="M9 19h11" />
      <path d="m3.5 5 1.3 1.4L7 4.2" />
      <path d="m3.5 12 1.3 1.4L7 11.2" />
      <path d="M3.8 19h.01" />
    </>
  ),
  inventory: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  reports: (
    <>
      <path d="M6 20V11" />
      <path d="M12 20V4" />
      <path d="M18 20v-6" />
      <path d="M3 20h18" />
    </>
  ),
  displays: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M9 20h6" />
      <path d="M12 16.5V20" />
    </>
  ),
  users: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.4 3-6 7-6s7 2.6 7 6" />
    </>
  ),
  roles: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3" />
      <path d="m18.7 5.3-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  audit: (
    <>
      <path d="M6.5 3h8L19 7.5V21H6.5z" />
      <path d="M14 3v5h5" />
      <path d="M9.5 13h6" />
      <path d="M9.5 17h4" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
