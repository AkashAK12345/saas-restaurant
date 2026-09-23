import type { ReactNode } from 'react';

/**
 * Glyphs for the queue screens, the dashboard sheet and the top bar.
 *
 * Inline SVG like the navigation icons: no dependency, no network request, and
 * `currentColor` so the surrounding tone colours the glyph. Every icon is
 * decorative (`aria-hidden`) — the control or text beside it carries the name.
 */
export type AppIconName =
  | 'back'
  | 'home'
  | 'queue'
  | 'monitor'
  | 'personAdd'
  | 'dialpad'
  | 'bell'
  | 'people'
  | 'person'
  | 'kid'
  | 'ticket'
  | 'phone'
  | 'clock'
  | 'table'
  | 'seat'
  | 'plus'
  | 'plusCircle'
  | 'fork'
  | 'fullscreen'
  | 'logout'
  | 'building'
  | 'emptyQueue'
  | 'chevronRight'
  | 'chevronDown'
  | 'chevronUp'
  | 'search'
  | 'devices'
  | 'calendar'
  | 'filter'
  | 'pin'
  | 'columns'
  | 'emptyCalendar'
  | 'wallet'
  | 'checkCircle'
  | 'noEntry'
  | 'share'
  | 'receipt'
  | 'moreCircle'
  | 'trendUp'
  | 'cash'
  | 'clipboardClock'
  | 'funnel'
  | 'sliders'
  | 'pencil'
  | 'close'
  | 'clipboard'
  | 'checklist'
  | 'fridge'
  | 'sun'
  | 'calendarCheck'
  | 'clipboardCheck'
  | 'box'
  | 'cart'
  | 'trash'
  | 'briefcase'
  | 'lightning'
  | 'shield'
  | 'parking'
  | 'door'
  | 'lift'
  | 'broom'
  | 'party'
  | 'chat'
  | 'archive'
  | 'image'
  | 'store'
  | 'check'
  | 'snowflake'
  | 'notes'
  | 'bowl'
  | 'flame'
  | 'fish'
  | 'grill'
  | 'lock'
  | 'scale';

const FILLED: Partial<Record<AppIconName, ReactNode>> = {
  people: (
    <>
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2 19.5c0-3.4 2.9-5.7 6.5-5.7S15 16.1 15 19.5z" />
      <circle cx="16.5" cy="8.5" r="2.7" />
      <path d="M16.2 13.9c3.2-.2 5.8 1.9 5.8 5.6h-5.1c0-2.2-.3-4-.7-5.6z" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7.5" r="3.8" />
      <path d="M4 20.5c0-4.1 3.6-6.8 8-6.8s8 2.7 8 6.8z" />
    </>
  ),
  personAdd: (
    <>
      <circle cx="14.5" cy="8" r="3.6" />
      <path d="M7.5 20.5c0-3.9 3.1-6.4 7-6.4s7 2.5 7 6.4z" />
      <path d="M5 6.5v6M2 9.5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  ticket: (
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM12 8.3v1.4m0 1.6v1.4m0 1.6v1.4" />
  ),
  bell: (
    <>
      <path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.8L4.8 16h14.4l-1.7-3.2V9A5.5 5.5 0 0 0 12 3.5z" />
      <path d="M9.8 18h4.4a2.2 2.2 0 0 1-4.4 0z" />
      <path d="M3.2 6.5 5 8M20.8 6.5 19 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </>
  ),
  fork: (
    <path d="M6 3v6.5a2 2 0 0 0 1.5 1.9V21h2v-9.6A2 2 0 0 0 11 9.5V3H9.6v5.5h-.9V3H7.3v5.5h-.9V3zm9.5 0c-1.9 1-3 3.2-3 6v4h2V21h2V3z" />
  ),
  phone: (
    <path d="M6.6 3.5 9 3a1 1 0 0 1 1.1.6l1.2 2.9a1 1 0 0 1-.3 1.2L9.4 9a11 11 0 0 0 5.6 5.6l1.3-1.6a1 1 0 0 1 1.2-.3l2.9 1.2a1 1 0 0 1 .6 1.1l-.5 2.4a1.2 1.2 0 0 1-1.2 1C11.1 18.4 5.6 12.9 5.6 4.7a1.2 1.2 0 0 1 1-1.2z" />
  ),
  table: (
    <>
      <path d="M3 7.5h18v2.2H3z" />
      <path d="M5 9.7h2.2V19H5zM16.8 9.7H19V19h-2.2zM7.2 12.8h9.6V15H7.2z" />
    </>
  ),
  seat: (
    <>
      <path d="M6 7.5A2.5 2.5 0 0 1 8.5 5h7A2.5 2.5 0 0 1 18 7.5V11H6z" />
      <path d="M3.5 11.2A1.8 1.8 0 0 1 6.9 11v2.3h10.2V11a1.8 1.8 0 0 1 3.4.2V17a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z" />
      <path d="M5.5 18h2v2h-2zM16.5 18h2v2h-2z" />
    </>
  ),
  plusCircle: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v9M7.5 12h9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  emptyQueue: (
    <>
      <path d="M3 5h12v2.6H3zM3 10h12v2.6H3zM3 15h7v2.6H3z" />
      <path d="M17 4.5h4.5V7H19.5v10.3a3.2 3.2 0 1 1-2.5-3.1z" />
    </>
  ),
  kid: undefined,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  noEntry: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M7.5 12h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  moreCircle: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="8" cy="12" r="1.4" fill="#fff" />
      <circle cx="12" cy="12" r="1.4" fill="#fff" />
      <circle cx="16" cy="12" r="1.4" fill="#fff" />
    </>
  ),
};

const STROKED: Record<AppIconName, ReactNode> = {
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
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
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="1.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  personAdd: null,
  dialpad: (
    <>
      <path d="M5 5h.01M9.5 5h.01M14 5h.01M5 9.5h.01M9.5 9.5h.01M14 9.5h.01M5 14h.01M9.5 14h.01M5 18.5h.01" strokeWidth="3" />
      <path d="m13 19 1-3.2 5.3-5.3a1.5 1.5 0 0 1 2.2 2.2L16.2 18z" />
    </>
  ),
  bell: null,
  people: null,
  person: null,
  kid: (
    <>
      <circle cx="12" cy="12.5" r="8" />
      <path d="M9 4.8c.6 1.6 1.8 2.4 3 2.4s2.2-.6 2.7-1.9" />
      <path d="M9.2 11.5h.01M14.8 11.5h.01" strokeWidth="2.4" />
      <path d="M9.3 15.3c1.5 1.3 3.9 1.3 5.4 0" />
    </>
  ),
  ticket: null,
  phone: null,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  table: null,
  seat: null,
  plus: <path d="M12 5v14M5 12h14" />,
  plusCircle: null,
  fork: null,
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  logout: (
    <>
      <path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" />
      <path d="M15 8l4 4-4 4M19 12H9.5" />
    </>
  ),
  building: (
    <>
      <path d="M4 20V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V20" />
      <path d="M14 10h4.5a1.5 1.5 0 0 1 1.5 1.5V20M2.5 20h19" />
      <path d="M7 7.5h.01M10.5 7.5h.01M7 11h.01M10.5 11h.01M7 14.5h.01M10.5 14.5h.01M17 13.5h.01M17 17h.01" strokeWidth="2.4" />
    </>
  ),
  emptyQueue: null,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  filter: <path d="M4 6.5h16M7 12h10M10 17.5h4" />,
  pin: (
    <>
      <path d="M12 21s6.5-5.8 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  columns: (
    <>
      <rect x="3.5" y="4.5" width="4.5" height="15" rx="1" />
      <rect x="9.75" y="4.5" width="4.5" height="15" rx="1" />
      <rect x="16" y="4.5" width="4.5" height="15" rx="1" />
    </>
  ),
  emptyCalendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="m9.5 14.5 1.8 1.8 3.4-3.4" />
    </>
  ),
  devices: (
    <>
      <rect x="2.5" y="5" width="13" height="10" rx="1.5" />
      <path d="M6 19h6M9 15v4" />
      <rect x="17.5" y="8" width="4" height="11" rx="1" />
    </>
  ),
  wallet: (
    <>
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <rect x="15" y="13" width="4" height="3" rx="1" />
    </>
  ),
  checkCircle: null,
  noEntry: null,
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" />
    </>
  ),
  moreCircle: null,
  trendUp: <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />,
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  clipboardClock: (
    <>
      <path d="M9 4h6v2.5H9z" />
      <path d="M15 5h2.5A1.5 1.5 0 0 1 19 6.5V11M9 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21H11" />
      <circle cx="17" cy="17" r="4" />
      <path d="M17 15.2V17l1.3 1" />
    </>
  ),
  funnel: <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />,
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />,
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="17" rx="2" />
      <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4.5" />
    </>
  ),
  checklist: (
    <>
      <path d="M4.5 5.8h.01M4.5 12h.01M4.5 18.2h.01" strokeWidth="2.6" />
      <path d="M9 5.8h10.5M9 12h10.5M9 18.2h10.5" />
    </>
  ),
  fridge: (
    <>
      <rect x="5.5" y="2.5" width="13" height="19" rx="2" />
      <path d="M5.5 10h13" />
      <path d="M8 5.2v2.3M8 12.7V15" strokeWidth="2.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.7 4.7l1.8 1.8M17.5 17.5l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.7 19.3l1.8-1.8M17.5 6.5l1.8-1.8" />
    </>
  ),
  calendarCheck: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="m9 15 2 2 4-4.2" />
    </>
  ),
  clipboardCheck: (
    <>
      <rect x="5" y="4.5" width="14" height="17" rx="2" />
      <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="m9 13.5 2 2 4-4.3" />
    </>
  ),
  box: (
    <>
      <path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" />
      <path d="M4 8.5V16l8 4.5V13M20 8.5V16l-8 4.5" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2.2l1 3M6.2 7l1.9 8.2a1.6 1.6 0 0 0 1.6 1.3h6.9a1.6 1.6 0 0 0 1.6-1.2L20 8.5H6.2Z" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4.3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.2" />
      <path d="M6.5 6.5 7.4 20a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-13.5" />
      <path d="M10.2 10.5v7M13.8 10.5v7" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5h18M10.7 12v1.6h2.6V12" />
    </>
  ),
  lightning: <path d="M13 2 5 14h5.5L11 22l8-13h-5.5z" />,
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  parking: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M10 16.5v-9h3a2.6 2.6 0 0 1 0 5.2h-3" />
    </>
  ),
  door: (
    <>
      <path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21" />
      <path d="M3.5 21h17" />
      <path d="M14.5 12h.01" strokeWidth="2.6" />
    </>
  ),
  lift: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9.5 9 12 6.5 14.5 9M9.5 15l2.5 2.5 2.5-2.5" />
    </>
  ),
  broom: (
    <>
      <path d="M14.5 3.5 11 12" />
      <path d="M6.5 12h8l1.5 8.5H5z" />
      <path d="M9 16v4.5M12.5 16v4.5" />
    </>
  ),
  party: (
    <>
      <path d="M4 20 8.5 7.5l8 8z" />
      <path d="M13 5.5c.5-1 1.3-1.5 2.3-1.5M17 9c1-.4 2-.3 2.8.3" />
      <path d="M15.5 3h.01M20.5 5.5h.01M20 12h.01" strokeWidth="2.6" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z" />
      <path d="M8 9h8M8 12.5h5" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="5" rx="1.2" />
      <path d="M5 9v10a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9" />
      <path d="M10 13h4" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  store: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0z" />
      <path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  notes: <path d="M4 6.5h16M4 12h12M4 17.5h8" />,
  bowl: (
    <>
      <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z" />
      <path d="M8 8.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" />
    </>
  ),
  flame: (
    <path d="M12 3s5 4.3 5 9a5 5 0 0 1-10 0c0-1.7.7-3.1 1.6-4.1.1 1.4.9 2.1 1.9 2.1.9 0 1.4-.8 1.1-2.1-.4-1.5-.5-3.4.4-4.9z" />
  ),
  fish: (
    <>
      <path d="M3 12c3-4 6.3-5.5 9.5-5.5 2.6 0 4.8 1.1 6.5 2.8-1.6 1.6-1.6 3.8 0 5.4-1.7 1.7-3.9 2.8-6.5 2.8C9.3 17.5 6 16 3 12z" />
      <path d="M19 9.3 21.5 7v10L19 14.7M8 11.5h.01" strokeWidth="2.2" />
    </>
  ),
  grill: (
    <>
      <path d="M4 5.5h16a8 8 0 0 1-16 0z" />
      <path d="m7.5 13-1.5 6.5M16.5 13l1.5 6.5M9 9.5h6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4.5v15M7.5 19.5h9M5 7.5h14" />
      <path d="M5 7.5 2.5 13a2.6 2.6 0 0 0 5 0zM19 7.5 16.5 13a2.6 2.6 0 0 0 5 0z" />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      <path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" />
    </>
  ),
};

export function AppIcon({ name, size = 24 }: { name: AppIconName; size?: number }) {
  const filled = FILLED[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {filled ?? STROKED[name]}
    </svg>
  );
}
