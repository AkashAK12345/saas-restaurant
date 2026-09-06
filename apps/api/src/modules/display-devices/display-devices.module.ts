import { Module } from '@nestjs/common';
import { DisplayDevicesService } from './display-devices.service.js';
import { DisplayDevicesController } from './display-devices.controller.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DisplayAuthModule } from '../../common/display-auth/display-auth.module.js';

@Module({
  imports: [
    AuthModule,          // JwtAuthGuard for staff management routes
    AuthorizationModule, // PermissionGuard + AuthorizationService
    DisplayAuthModule,   // credential issuing (shared with the device guard)
  ],
  controllers: [DisplayDevicesController],
  providers: [DisplayDevicesService],
  exports: [DisplayDevicesService],
})
export class DisplayDevicesModule {}
