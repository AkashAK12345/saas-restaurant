import { Module } from '@nestjs/common';
import { DisplayDeviceAuthService } from './display-device-auth.service.js';
import { DisplayDeviceGuard } from './display-device.guard.js';

// DatabaseModule is @Global() so PrismaService is already available.
@Module({
  providers: [DisplayDeviceAuthService, DisplayDeviceGuard],
  exports: [DisplayDeviceAuthService, DisplayDeviceGuard],
})
export class DisplayAuthModule {}
