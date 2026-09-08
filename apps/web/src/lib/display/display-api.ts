import { apiBaseUrl } from '@/lib/api/client';
import type { StreamTicketResponse } from '@/lib/api/types';
import type { QueueAdminBoard, QueueCustomerBoard } from '@/lib/queue/types';
import type { ChefBoard } from '@/lib/banquet/types';
import type { DeviceSession } from './device-session';

/** Realtime channels a display device may request a ticket for. */
export type DisplayChannel = 'queue' | 'banquet-kds';

/**
 * Device-authenticated calls. This is the SAME authentication scheme T0-A
 * defined (`Authorization: Display <deviceId>.<secret>` + X-Branch-ID), not a
 * second one: there is simply no staff client here to reuse, because the
 * display tree deliberately has no session, no provider and no JWT.
 *
 * The credential goes in the header on every request and appears nowhere else
 * — not in a URL, not in an error message, not in a log line.
 */
export type DisplayKind = 'QUEUE_CUSTOMER' | 'QUEUE_ADMIN' | 'BANQUET_CHEF';

export interface DisplayIdentity {
  id: string;
  branch_id: string;
  kind: DisplayKind;
}

export interface DisplayBranch {
  id: string;
  name: string;
  timezone: string;
}

/** The device is not (or no longer) accepted: revoked, wrong branch, mistyped. */
export class DisplayAuthError extends Error {
  constructor(message = 'This screen is not paired') {
    super(message);
    this.name = 'DisplayAuthError';
  }
}

async function displayRequest<T>(
  path: string,
  session: DeviceSession,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Display ${session.credential}`,
    'X-Branch-ID': session.branchId,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(apiBaseUrl() + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    // Deliberately generic and credential-free.
    throw new DisplayAuthError(
      res.status === 403 ? 'This screen is not allowed to show this board' : 'This screen is not paired',
    );
  }
  if (!res.ok) throw new Error(`Display request failed (${res.status})`);
  return (await res.json()) as T;
}

export const displayApi = {
  me: (s: DeviceSession) => displayRequest<DisplayIdentity>('/display/me', s),
  branch: (s: DeviceSession) => displayRequest<DisplayBranch>('/display/branch', s),
  customerBoard: (s: DeviceSession) => displayRequest<QueueCustomerBoard>('/display/queue/board', s),
  adminBoard: (s: DeviceSession) => displayRequest<QueueAdminBoard>('/display/queue/board', s),
  /** The kitchen board for a BANQUET_CHEF device. */
  banquetBoard: (s: DeviceSession) => displayRequest<ChefBoard>('/display/banquet/board', s),
  /**
   * Single-use, 60-second ticket — the only thing that may go in the stream
   * URL. The channel a device may ask for is restricted by its kind
   * server-side, so requesting the wrong one is refused rather than ignored.
   */
  streamTicket: (s: DeviceSession, channel: DisplayChannel = 'queue') =>
    displayRequest<StreamTicketResponse>('/display/stream-tickets', s, {
      method: 'POST',
      body: { channel },
    }),
};
