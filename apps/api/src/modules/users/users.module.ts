import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AuthModule,          // provides JwtAuthGuard
    AuthorizationModule, // provides PermissionGuard + AuthorizationService
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
