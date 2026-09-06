import { DisplayDeviceKind } from '@samco/database';
import { PERMISSION_KEYS, type PermissionKey } from '../authorization/permission-keys.js';

/**
 * Real-time channels. Deliberately coarse and domain-agnostic: a channel is a
 * fan-out topic scoped by (company, branch), not an event type. Domain modules
 * choose their own event `type` strings when they publish.
 */
export enum RealtimeChannel {
  QUEUE = 'queue',
  BANQUET_KDS = 'banquet-kds',
  TASKS = 'tasks',
}

export const REALTIME_CHANNELS: readonly RealtimeChannel[] = Object.values(RealtimeChannel);

export function isRealtimeChannel(value: unknown): value is RealtimeChannel {
  return typeof value === 'string' && (REALTIME_CHANNELS as string[]).includes(value);
}

/**
 * The permission a STAFF user must hold at the branch to subscribe to a
 * channel there. Resolved statically per route so PermissionGuard can enforce
 * it with the ordinary @RequireBranchPermission decorator — no dynamic
 * permission lookup, no second authorization path.
 */
export const STAFF_CHANNEL_PERMISSION: Readonly<Record<RealtimeChannel, PermissionKey>> = {
  [RealtimeChannel.QUEUE]: PERMISSION_KEYS.QUEUE_VIEW,
  [RealtimeChannel.BANQUET_KDS]: PERMISSION_KEYS.BANQUET_KDS_VIEW,
  [RealtimeChannel.TASKS]: PERMISSION_KEYS.TASKS_VIEW,
};

/**
 * Which channels each DISPLAY kind may subscribe to. Displays never choose
 * freely: a request for any channel outside this list is rejected, and there
 * is no display path to `tasks` at all.
 */
export const DISPLAY_KIND_CHANNELS: Readonly<Record<DisplayDeviceKind, readonly RealtimeChannel[]>> = {
  [DisplayDeviceKind.QUEUE_CUSTOMER]: [RealtimeChannel.QUEUE],
  [DisplayDeviceKind.QUEUE_ADMIN]: [RealtimeChannel.QUEUE],
  [DisplayDeviceKind.BANQUET_CHEF]: [RealtimeChannel.BANQUET_KDS],
};

export function displayKindMaySubscribe(kind: DisplayDeviceKind, channel: RealtimeChannel): boolean {
  return DISPLAY_KIND_CHANNELS[kind].includes(channel);
}
