import { hasAnyPermission, type PermissionKey } from '@/lib/auth/permissions';
import type { AppIconName } from '@/components/app/icons';

/**
 * The queue's screens — one list used by the dashboard's Queue sheet and the
 * queue tab bar, so a screen can never appear in one and not the other.
 *
 * Visibility follows the branch permission the screen's own API calls need.
 * It is a courtesy: every page still asks the API, which decides.
 */
export type QueueTone = 'blue' | 'terracotta' | 'green' | 'amber' | 'purple';

export interface QueueSurface {
  key: 'display' | 'podium' | 'register' | 'waiter' | 'customer';
  href: string;
  /** Title in the dashboard sheet. */
  title: string;
  /** Short label in the tab bar. */
  tab: string;
  subtitle: string;
  icon: AppIconName;
  tone: QueueTone;
  /** Any one of these shows the screen. */
  permissions: readonly PermissionKey[];
}

export const QUEUE_SURFACES: readonly QueueSurface[] = [
  {
    key: 'display',
    href: '/queue',
    title: 'Admin Display',
    tab: 'Display',
    subtitle: 'Live queue overview',
    icon: 'monitor',
    tone: 'blue',
    permissions: ['queue.view'],
  },
  {
    key: 'podium',
    href: '/queue/podium',
    title: 'Podium Operator',
    tab: 'Podium',
    subtitle: 'Register & call customers',
    icon: 'personAdd',
    tone: 'terracotta',
    permissions: ['queue.register', 'queue.call'],
  },
  {
    key: 'register',
    href: '/queue/register',
    title: 'Customer Register',
    tab: 'Register',
    subtitle: 'Self check-in',
    icon: 'dialpad',
    tone: 'green',
    permissions: ['queue.register'],
  },
  {
    key: 'waiter',
    href: '/queue/tables',
    title: 'Waiter',
    tab: 'Waiter',
    subtitle: 'Table management',
    icon: 'bell',
    tone: 'amber',
    permissions: ['queue.seat'],
  },
  {
    key: 'customer',
    href: '/queue/display',
    title: 'Customer Display',
    tab: 'Customer',
    subtitle: 'Now serving & waiting',
    icon: 'monitor',
    tone: 'purple',
    permissions: ['queue.view'],
  },
];

export function visibleSurfaces(permissions: readonly string[] | undefined): QueueSurface[] {
  return QUEUE_SURFACES.filter((s) => hasAnyPermission(permissions, s.permissions));
}

/** True when the viewer may open at least one queue screen at this branch. */
export function hasQueueAccess(permissions: readonly string[] | undefined): boolean {
  return visibleSurfaces(permissions).length > 0;
}

/** True for `/queue` and every path under it. */
export function isQueuePath(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === '/queue' || pathname.startsWith('/queue/'));
}
