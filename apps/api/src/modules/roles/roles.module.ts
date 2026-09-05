import { Module } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { RolesController } from './roles.controller.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AuthModule,          // provides JwtAuthGuard
    AuthorizationModule, // provides PermissionGuard + AuthorizationService
  ],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
