import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';

export const JOB_LOCK = Symbol('JOB_LOCK');

/**
 * Cross-process mutual exclusion for a scheduled job.
 *
 * `runExclusive` runs `fn` only if no other process holds the job's lock, and
 * reports whether it ran. A job that is skipped because another replica has it
 * is not a failure — it is exactly the outcome the lock exists for.
 */
export interface JobLock {
  runExclusive(name: string, fn: () => Promise<void>): Promise<boolean>;
}

/** How long one run may hold the lock before PostgreSQL gives the connection back. */
export const JOB_LOCK_MAX_RUN_MS = 10 * 60_000;

/**
 * PostgreSQL advisory lock, TRANSACTION-scoped.
 *
 * pg_try_advisory_xact_lock is taken on the connection of an open transaction
 * and released automatically when that transaction ends — commit, rollback,
 * crash or dropped connection — so a lock can never outlive the run that took
 * it. A session-level lock would be wrong with a connection pool: the unlock
 * could run on a different connection from the lock and silently do nothing.
 *
 * The transaction itself does no work; it only holds the lock. The job keeps
 * using its own connections and its own transactions, and its idempotency at
 * the data layer (unique constraints, conditional updates) still stands —
 * this lock removes wasted duplicate runs across replicas, it is not what
 * keeps the data correct.
 */
@Injectable()
export class PostgresJobLock implements JobLock {
  constructor(private readonly prisma: PrismaService) {}

  async runExclusive(name: string, fn: () => Promise<void>): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${`samco.job:${name}`})) AS "locked"`;
        if (!row?.locked) return false;
        await fn();
        return true;
      },
      { maxWait: 5_000, timeout: JOB_LOCK_MAX_RUN_MS },
    );
  }
}
