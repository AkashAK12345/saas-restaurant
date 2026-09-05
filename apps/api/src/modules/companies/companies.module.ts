import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CompaniesController } from './companies.controller.js';
import { MembershipsController } from './memberships.controller.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AuthModule,          // provides JwtAuthGuard
    AuthorizationModule, // provides PermissionGuard + AuthorizationService
  ],
  controllers: [CompaniesController, MembershipsController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
