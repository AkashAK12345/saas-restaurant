import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

export type JobHandler = () => Promise<void> | void;

export interface JobDefinition {
  /** Unique across the process. Registering a name twice is a programming error. */
  name: string;
  handler: JobHandler;
}

export interface IntervalJobDefinition extends JobDefinition {
  everyMs: number;
}

export interface CronJobDefinition extends JobDefinition {
  /** Standard 5/6-field cron expression. Evaluated in UTC — see timezone note. */
  cron: string;
}

export interface JobStatus {
  name: string;
  kind: 'interval' | 'cron';
  schedule: string;
  running: boolean;
  runs: number;
  failures: number;
  skippedOverlaps: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

interface JobState extends JobStatus {
  handler: JobHandler;
}

/**
 * Process-wide job registry: the ONLY place scheduled work is registered.
 *
 * WHAT IT IS
 *   A thin, opinionated layer over @nestjs/schedule's SchedulerRegistry that
 *   adds the guarantees domain jobs need and would otherwise each reinvent:
 *     - unique job names (duplicate registration throws),
 *     - a per-job overlap guard: if a run is still in progress when the next
 *       tick arrives, the tick is skipped and counted, never stacked,
 *     - failure containment: a throwing handler is logged and counted; it never
 *       takes the scheduler or the process down,
 *     - a kill switch (`SCHEDULER_ENABLED=false`) so tests and non-production
 *       processes can register jobs without any timer ever firing,
 *     - per-job status for diagnostics.
 *
 * WHAT IT IS NOT
 *   It contains no business logic and never will. A job's handler should be a
 *   one-line call into an application service:
 *
 *       registry.registerInterval({
 *         name: 'routines.generate',
 *         everyMs: 5 * 60_000,
 *         handler: () => this.routineGeneration.generateUpcoming(),
 *       });
 *
 *   The service — not the job — decides what to do, using branch-local time
 *   (see branch-time.ts).
 *
 * SINGLE-INSTANCE — the limitation, stated plainly
 *   This registry schedules within ONE process. Run two API replicas and every
 *   job fires twice, once per replica, at roughly the same moment. The overlap
 *   guard above is per-process and does nothing about that.
 *
 *   Consequences for future domain jobs:
 *     - every job MUST be idempotent at the data layer (e.g. a unique
 *       constraint such as (routine_id, scheduled_for) so a duplicate run is a
 *       no-op, not a duplicate row);
 *     - jobs must never assume they are the only runner.
 *   Distributed scheduling / a shared lock (Redis, advisory locks) is deferred
 *   and tracked as BACKLOG with the broker and throttle. This is the same
 *   trade-off as those, made for the same reason: the current deployment is a
 *   single instance and adding infrastructure for a constraint that does not
 *   yet exist would be premature.
 *
 * TIMEZONE
 *   Cron expressions here run in UTC. That is fine for "wake up every N
 *   minutes" jobs, which is the intended pattern: a job wakes on a coarse UTC
 *   cadence and its service evaluates, per branch, whether anything is due in
 *   that branch's local time. Do NOT encode a business time ("09:00") in a cron
 *   expression here — it would be 09:00 UTC for every branch on the platform.
 */
@Injectable()
export class JobRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly jobs = new Map<string, JobState>();
  readonly enabled: boolean;

  constructor(
    private readonly scheduler: SchedulerRegistry,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('SCHEDULER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn('Scheduler disabled (SCHEDULER_ENABLED=false): jobs register but never fire');
    }
  }

  private assertUnique(name: string): void {
    if (!name || !/^[a-z0-9._-]+$/i.test(name)) {
      throw new Error(`Invalid job name "${name}"`);
    }
    if (this.jobs.has(name)) {
      throw new Error(`Job "${name}" is already registered`);
    }
  }

  private newState(def: JobDefinition, kind: JobStatus['kind'], schedule: string): JobState {
    return {
      name: def.name,
      kind,
      schedule,
      running: false,
      runs: 0,
      failures: 0,
      skippedOverlaps: 0,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastError: null,
      handler: def.handler,
    };
  }

  /**
   * Wraps a handler with the overlap guard and failure containment.
   * Exposed as the public `run()` so tests — and, later, an operator endpoint —
   * can trigger a job on demand through exactly the same path the timer uses.
   */
  async run(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job "${name}"`);

    if (job.running) {
      job.skippedOverlaps += 1;
      this.logger.warn(`Job "${name}" skipped: previous run still in progress`);
      return;
    }

    job.running = true;
    job.lastStartedAt = new Date().toISOString();
    try {
      await job.handler();
      job.runs += 1;
      job.lastError = null;
    } catch (err) {
      job.failures += 1;
      job.lastError = err instanceof Error ? err.message : String(err);
      // Contained: logged, counted, and the scheduler carries on.
      this.logger.error(`Job "${name}" failed: ${job.lastError}`, err instanceof Error ? err.stack : undefined);
    } finally {
      job.running = false;
      job.lastFinishedAt = new Date().toISOString();
    }
  }

  registerInterval(def: IntervalJobDefinition): void {
    this.assertUnique(def.name);
    if (!Number.isInteger(def.everyMs) || def.everyMs <= 0) {
      throw new Error(`Job "${def.name}": everyMs must be a positive integer`);
    }
    this.jobs.set(def.name, this.newState(def, 'interval', `every ${def.everyMs}ms`));

    if (!this.enabled) return;
    const timer = setInterval(() => void this.run(def.name), def.everyMs);
    // Never keep a shutting-down process alive just to tick.
    timer.unref?.();
    this.scheduler.addInterval(def.name, timer);
    this.logger.log(`Registered interval job "${def.name}" (${def.everyMs}ms)`);
  }

  registerCron(def: CronJobDefinition): void {
    this.assertUnique(def.name);
    // Validate the expression up front so a typo fails at boot, not at 03:00.
    let job: CronJob;
    try {
      job = new CronJob(def.cron, () => void this.run(def.name), null, false, 'UTC');
    } catch (err) {
      throw new Error(`Job "${def.name}": invalid cron expression "${def.cron}" (${(err as Error).message})`);
    }
    this.jobs.set(def.name, this.newState(def, 'cron', def.cron));

    if (!this.enabled) return;
    this.scheduler.addCronJob(def.name, job);
    job.start();
    this.logger.log(`Registered cron job "${def.name}" (${def.cron} UTC)`);
  }

  has(name: string): boolean {
    return this.jobs.has(name);
  }

  status(name: string): JobStatus | undefined {
    const job = this.jobs.get(name);
    if (!job) return undefined;
    const { handler: _h, ...status } = job;
    return status;
  }

  list(): JobStatus[] {
    return [...this.jobs.keys()].map((n) => this.status(n)!);
  }

  /** Stop every timer this registry started. Safe to call when disabled. */
  onModuleDestroy(): void {
    for (const [name, job] of this.jobs) {
      if (!this.enabled) continue;
      try {
        if (job.kind === 'interval') this.scheduler.deleteInterval(name);
        else this.scheduler.deleteCronJob(name);
      } catch {
        // Already gone — nothing to do.
      }
    }
    this.jobs.clear();
  }
}
