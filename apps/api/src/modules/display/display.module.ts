import { Module } from '@nestjs/common';
import { DisplayController } from './display.controller.js';
import { DisplayAuthModule } from '../../common/display-auth/display-auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { QueueTokensModule } from '../queue-tokens/queue-tokens.module.js';

// Deliberately does NOT import AuthModule or AuthorizationModule: nothing here
// may ever be reachable with a staff JWT or satisfied by an RBAC permission.
// QueueTokensModule is imported for its READ projections only — the device
// routes below call no mutation, and the service's mutations all require a
// QueueActorContext that only an RBAC-guarded staff route can produce.
@Module({
  imports: [DisplayAuthModule, RealtimeModule, QueueTokensModule],
  controllers: [DisplayController],
})
export class DisplayModule {}
