import { Module } from '@nestjs/common';
import { DisplayController } from './display.controller.js';
import { DisplayAuthModule } from '../../common/display-auth/display-auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

// Deliberately does NOT import AuthModule or AuthorizationModule: nothing here
// may ever be reachable with a staff JWT or satisfied by an RBAC permission.
@Module({
  imports: [DisplayAuthModule, RealtimeModule],
  controllers: [DisplayController],
})
export class DisplayModule {}
