import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { RoutinesService } from './routines.service.js';
import { ChecklistTemplatesService } from './checklist-templates.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { RealtimeCoreModule } from '../../common/realtime/realtime-core.module.js';
import { SchedulerModule } from '../../common/scheduler/scheduler.module.js';
import { JobRegistry } from '../../common/scheduler/job-registry.service.js';
import { ReportingCoreModule } from '../reports/reporting-core.module.js';
import {
  TaskAssigneeReport,
  TaskCompletionReport,
  TaskLogReport,
  TaskReportRegistrar,
  TaskRoutineReport,
  TasksOpenWidget,
} from './tasks.report-provider.js';
import { EodComplianceReport, EodLogReport } from './eod.report-provider.js';
import { OperationalComplianceReport, OperationalLogReport } from './operational.report-provider.js';
import { KitchenComplianceReport, KitchenLogReport } from './kitchen.report-provider.js';
import { OpeningComplianceReport, OpeningLogReport } from './opening.report-provider.js';
import { BanquetOpeningComplianceReport, BanquetOpeningLogReport } from './banquet-opening.report-provider.js';
import { BmComplianceReport, BmLogReport } from './bm.report-provider.js';
import { KitchenBalanceComplianceReport, KitchenBalanceLogReport } from './kitchen-balance.report-provider.js';
import { BiryaniSalesComplianceReport, BiryaniSalesLogReport } from './biryani-sales.report-provider.js';

/** How often the process wakes to look for due routine occurrences. */
export const ROUTINE_JOB_NAME = 'tasks.routines.materialize';
export const ROUTINE_JOB_INTERVAL_MS = 5 * 60_000;

/**
 * Registers the one scheduled job Phase 9 needs.
 *
 * The job is a ONE-LINE DELEGATION, exactly as the T0-C registry documents:
 * it holds no business logic, decides nothing, and knows nothing about
 * branches or timezones. RoutinesService does all of that, reading each
 * branch's own local time.
 *
 * A coarse UTC cadence is correct here precisely because the service — not the
 * cron expression — decides what is due where. Encoding "09:00" in a schedule
 * would mean 09:00 UTC for every branch on the platform.
 *
 * SINGLE INSTANCE: two API replicas run this job twice. That is safe rather
 * than merely tolerated, because materialization is idempotent at the database
 * level: (routine_id, routine_occurrence_date) is UNIQUE, so the second run
 * gets a duplicate-key error the service counts as "skipped". Distributed
 * locking remains a documented T0 backlog item, not a Phase 9 pretence.
 *
 * `SCHEDULER_ENABLED=false` (the T0-C kill switch) registers the job without
 * ever firing it — which is how the test suites run.
 */
@Injectable()
export class RoutineScheduler implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly routines: RoutinesService,
  ) {}

  onModuleInit(): void {
    this.registry.registerInterval({
      name: ROUTINE_JOB_NAME,
      everyMs: ROUTINE_JOB_INTERVAL_MS,
      handler: async () => {
        await this.routines.materializeAllBranches();
      },
    });
  }
}

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    RealtimeCoreModule,
    SchedulerModule,
    ReportingCoreModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    RoutinesService,
    ChecklistTemplatesService,
    RoutineScheduler,
    TaskCompletionReport,
    TaskAssigneeReport,
    TaskRoutineReport,
    TaskLogReport,
    EodLogReport,
    EodComplianceReport,
    OperationalLogReport,
    OperationalComplianceReport,
    KitchenLogReport,
    KitchenComplianceReport,
    OpeningLogReport,
    OpeningComplianceReport,
    BanquetOpeningLogReport,
    BanquetOpeningComplianceReport,
    BmLogReport,
    BmComplianceReport,
    KitchenBalanceLogReport,
    KitchenBalanceComplianceReport,
    BiryaniSalesLogReport,
    BiryaniSalesComplianceReport,
    TasksOpenWidget,
    TaskReportRegistrar,
  ],
  exports: [TasksService, RoutinesService],
})
export class TasksModule {}
