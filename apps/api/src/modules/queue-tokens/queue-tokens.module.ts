import { Module } from '@nestjs/common';
import { QueueTokensController } from './queue-tokens.controller.js';
import { QueueTokensService } from './queue-tokens.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { RealtimeCoreModule } from '../../common/realtime/realtime-core.module.js';

/**
 * Phase 7 — queue token domain. PrismaService and AuditLogService come from
 * their global modules; EVENT_BROKER from RealtimeCoreModule (the T0-B seam —
 * this module publishes, it never serves streams).
 */
@Module({
  imports: [AuthModule, AuthorizationModule, RealtimeCoreModule],
  controllers: [QueueTokensController],
  providers: [QueueTokensService],
  exports: [QueueTokensService],
})
export class QueueTokensModule {}
