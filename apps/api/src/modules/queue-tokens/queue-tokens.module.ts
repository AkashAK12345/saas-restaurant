import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { QueueTokensController } from './queue-tokens.controller.js';
import { QueueTokensService } from './queue-tokens.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { RealtimeCoreModule } from '../../common/realtime/realtime-core.module.js';
import { SchedulerModule } from '../../common/scheduler/scheduler.module.js';
import { JobRegistry } from '../../common/scheduler/job-registry.service.js';
import { ReportingCoreModule } from '../reports/reporting-core.module.js';
import {
  QueueReportRegistrar,
  QueueSummaryReport,
  QueueTodayWidget,
  QueueTokensReport,
} from './queue.report-provider.js';

/** How often the process looks for scheduled bookings whose time has come. */
export const QUEUE_ACTIVATION_JOB_NAME = 'queue.scheduled.activate';
export const QUEUE_ACTIVATION_INTERVAL_MS = 60_000;

/**
 * Surfaces advance bookings at their time. A one-line delegation, exactly as
 * the JobRegistry documents: QueueTokensService decides what is due, and does
 * so idempotently, so a second replica running the same job changes nothing.
 * `SCHEDULER_ENABLED=false` registers it without ever firing it.
 */
@Injectable()
export class QueueScheduler implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly queueTokens: QueueTokensService,
  ) {}

  onModuleInit(): void {
    this.registry.registerInterval({
      name: QUEUE_ACTIVATION_JOB_NAME,
      everyMs: QUEUE_ACTIVATION_INTERVAL_MS,
      handler: async () => {
        await this.queueTokens.activateDueScheduled();
      },
    });
  }
}

/**
 * Phase 7 — queue token domain. PrismaService and AuditLogService come from
 * their global modules; EVENT_BROKER from RealtimeCoreModule (the T0-B seam —
 * this module publishes, it never serves streams).
 */
@Module({
  imports: [AuthModule, AuthorizationModule, RealtimeCoreModule, SchedulerModule, ReportingCoreModule],
  controllers: [QueueTokensController],
  providers: [
    QueueTokensService,
    QueueScheduler,
    QueueSummaryReport,
    QueueTokensReport,
    QueueTodayWidget,
    QueueReportRegistrar,
  ],
  exports: [QueueTokensService],
})
export class QueueTokensModule {}
