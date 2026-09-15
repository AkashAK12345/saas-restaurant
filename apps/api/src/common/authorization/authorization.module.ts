import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { PermissionGuard } from './permission.guard.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

// DatabaseModule is @Global() so PrismaService is already available
// without importing DatabaseModule here.
@Module({
  providers: [AuthorizationService, PermissionGuard, PlatformAdminGuard],
  exports: [AuthorizationService, PermissionGuard, PlatformAdminGuard],
})
export class AuthorizationModule {}
