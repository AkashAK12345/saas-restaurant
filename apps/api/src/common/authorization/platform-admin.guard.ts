import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Platform-operation guard.
 *
 * Must be used after JwtAuthGuard (which sets req.user). Admits only an ACTIVE
 * user whose `is_superadmin` flag is set, read fresh from the database on every
 * request — never from the token, a header or the request body.
 *
 * Scope is deliberately narrow: it protects the few operations that have no
 * company to scope a permission against (creating a company). It is NOT a
 * bypass: `is_superadmin` still confers no company- or branch-scoped
 * authorization anywhere — PermissionGuard and AuthorizationService never
 * consult it. X-Company-ID / X-Branch-ID are ignored here.
 *
 * The flag cannot be set through any API (the user DTOs do not accept it); it
 * is granted by an operator directly in the database.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id;
    if (!userId) {
      // JwtAuthGuard should have handled this, but guard defensively
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { is_superadmin: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.is_superadmin !== true) {
      throw new ForbiddenException();
    }
    return true;
  }
}
