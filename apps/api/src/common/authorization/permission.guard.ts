import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from './authorization.service.js';
import {
  PERMISSION_META_KEY,
  type PermissionMeta,
} from './require-permission.decorator.js';

/**
 * Scope-aware permission guard.
 *
 * Must be used after JwtAuthGuard (which sets req.user).
 *
 * Reads @RequireCompanyPermission or @RequireBranchPermission metadata
 * and enforces the appropriate verification:
 *
 *   company scope:
 *     - Requires X-Company-ID header
 *     - Verifies ACTIVE CompanyMembership
 *     - Checks permission via any branch role in the company
 *
 *   branch scope:
 *     - Requires X-Company-ID + X-Branch-ID headers
 *     - Verifies ACTIVE CompanyMembership
 *     - Verifies branch belongs to company
 *     - Checks permission via branch roles at that specific branch
 *
 * If no @RequireCompanyPermission / @RequireBranchPermission is present on the
 * handler or class, the guard passes through (no authorization required).
 *
 * Note: is_superadmin does NOT bypass this guard.
 * Platform-level superadmin policy is not yet defined and must not be assumed.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<PermissionMeta | undefined>(
      PERMISSION_META_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission required on this route — pass through
    if (!meta) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { id: string };
      headers: Record<string, string | undefined>;
    }>();

    const user = request.user;
    if (!user?.id) {
      // JwtAuthGuard should have handled this, but guard defensively
      throw new UnauthorizedException('Authentication required');
    }

    const companyId = request.headers['x-company-id'];
    if (!companyId) {
      throw new ForbiddenException('Missing required company context (X-Company-ID)');
    }

    if (meta.scope === 'branch') {
      const branchId = request.headers['x-branch-id'];
      if (!branchId) {
        throw new ForbiddenException('Missing required branch context (X-Branch-ID)');
      }

      const allowed =
        typeof meta.permission === 'string'
          ? await this.authorizationService.hasBranchPermission(user.id, companyId, branchId, meta.permission)
          : await this.authorizationService.hasAnyBranchPermission(user.id, companyId, branchId, meta.permission);

      if (!allowed) throw new ForbiddenException();
    } else {
      // Any-of lists are a branch-scope feature only: every company-scoped
      // route names exactly one key, and keeping it that way keeps these two
      // paths unchanged.
      if (typeof meta.permission !== 'string') {
        throw new ForbiddenException();
      }
      // Lifecycle transitions only ('company_status'). Same membership +
      // permission proof as 'company' scope, without the company-must-be-ACTIVE
      // precondition, so a disabled company remains recoverable by its own
      // administrators.
      const allowed =
        meta.scope === 'company_status'
          ? await this.authorizationService.hasCompanyStatusPermission(user.id, companyId, meta.permission)
          : await this.authorizationService.hasCompanyPermission(user.id, companyId, meta.permission);

      if (!allowed) throw new ForbiddenException();
    }

    return true;
  }
}
