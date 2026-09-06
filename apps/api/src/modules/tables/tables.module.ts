import { Module } from '@nestjs/common';
import { TablesService } from './tables.service.js';
import { TablesController } from './tables.controller.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AuthModule,          // provides JwtAuthGuard
    AuthorizationModule, // provides PermissionGuard + AuthorizationService
  ],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
