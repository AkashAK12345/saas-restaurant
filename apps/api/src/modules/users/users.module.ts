import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { UserAccessController } from './user-access.controller.js';
import { UserAccessService } from './user-access.service.js';
import { UserGroupsController } from './user-groups.controller.js';
import { UserGroupsService } from './user-groups.service.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AuthModule,          // provides JwtAuthGuard
    AuthorizationModule, // provides PermissionGuard + AuthorizationService
  ],
  controllers: [UsersController, UserAccessController, UserGroupsController],
  providers: [UsersService, UserAccessService, UserGroupsService],
})
export class UsersModule {}
