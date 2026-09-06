import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DisplayDeviceKind } from '@samco/database';
import {
  DisplayDeviceAuthService,
  type AuthenticatedDisplay,
} from './display-device-auth.service.js';
import { DISPLAY_KIND_META_KEY } from './require-display-kind.decorator.js';

/** The header scheme. `Authorization: Display <deviceId>.<secret>` */
const SCHEME = 'display';

export interface DisplayRequest {
  display?: AuthenticatedDisplay;
  headers: Record<string, string | undefined>;
}

/**
 * Authentication + coarse authorization for display devices.
 *
 * Deliberately NOT a Passport strategy and NOT layered on JwtAuthGuard or
 * PermissionGuard: a screen is not a user and must never be able to satisfy
 * an RBAC check. The only things this guard establishes are
 *
 *   1. the credential is valid and the device is ACTIVE,
 *   2. the device belongs to the branch named in X-Branch-ID,
 *   3. the branch and company are ACTIVE,
 *   4. the device kind is permitted for this route (@RequireDisplayKind).
 *
 * Failures of 1–3 are all a generic 401. Failure of 4 is a 403 (the device is
 * genuine, just the wrong kind of screen for this projection).
 *
 * Read-only by contract: this foundation is for future read/stream routes.
 * KDS-style writes will go through staff RBAC, never through a device.
 */
@Injectable()
export class DisplayDeviceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly displayAuth: DisplayDeviceAuthService,
  ) {}

  private extractCredential(headers: Record<string, string | undefined>): string | undefined {
    const raw = headers['authorization'];
    if (!raw) return undefined;
    const [scheme, value] = raw.split(/\s+/, 2);
    if (!scheme || scheme.toLowerCase() !== SCHEME) return undefined;
    return value;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DisplayRequest>();

    const credential = this.extractCredential(request.headers);
    const branchId = request.headers['x-branch-id'];

    const display = await this.displayAuth.authenticate(credential, branchId);
    if (!display) {
      throw new UnauthorizedException('Invalid display credential');
    }

    const allowedKinds = this.reflector.getAllAndOverride<DisplayDeviceKind[] | undefined>(
      DISPLAY_KIND_META_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowedKinds && allowedKinds.length > 0 && !allowedKinds.includes(display.kind)) {
      throw new ForbiddenException('This display kind cannot access this resource');
    }

    request.display = display;
    return true;
  }
}
