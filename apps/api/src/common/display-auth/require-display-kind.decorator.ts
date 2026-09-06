import { SetMetadata } from '@nestjs/common';
import type { DisplayDeviceKind } from '@samco/database';

export const DISPLAY_KIND_META_KEY = 'samco:display_kinds';

/**
 * Restricts a display route to specific device kinds.
 *
 * A route without this decorator (but behind DisplayDeviceGuard) accepts any
 * authenticated, ACTIVE device of the requested branch. With it, the guard
 * additionally rejects devices whose `kind` is not listed — e.g. a chef board
 * must never be able to read the queue projection.
 */
export const RequireDisplayKind = (...kinds: DisplayDeviceKind[]) =>
  SetMetadata<string, DisplayDeviceKind[]>(DISPLAY_KIND_META_KEY, kinds);
