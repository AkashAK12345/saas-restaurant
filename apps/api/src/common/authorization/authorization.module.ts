import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { PermissionGuard } from './permission.guard.js';

// DatabaseModule is @Global() so PrismaService is already available
// without importing DatabaseModule here.
@Module({
  providers: [AuthorizationService, PermissionGuard],
  exports: [AuthorizationService, PermissionGuard],
})
export class AuthorizationModule {}
