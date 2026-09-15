import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JobRegistry } from './job-registry.service.js';
import { JOB_LOCK, PostgresJobLock } from './job-lock.js';

/**
 * Scheduler foundation. Provides JobRegistry (with the PostgreSQL advisory
 * job lock, so replicas do not duplicate work); registers NO jobs.
 *
 * Domain modules that need scheduled work import this module and call
 * `JobRegistry.registerInterval / registerCron` from their own `onModuleInit`,
 * passing a handler that delegates to their service. Nothing domain-specific
 * belongs here.
 */
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
  providers: [JobRegistry, { provide: JOB_LOCK, useClass: PostgresJobLock }],
  exports: [JobRegistry],
})
export class SchedulerModule {}
