import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeCoreModule } from '../../common/realtime/realtime-core.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';

@Module({
  imports: [ConfigModule, RealtimeCoreModule, AuthModule, AuthorizationModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
