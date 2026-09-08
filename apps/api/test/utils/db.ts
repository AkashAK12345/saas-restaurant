import type { PrismaService } from '../../src/core/database/prisma.service.js';

/**
 * Shared E2E database helpers.
 *
 * WHY audit logs need special handling
 * ------------------------------------
 * `audit_logs` carries BEFORE UPDATE / BEFORE DELETE triggers that reject those
 * operations outright (migration 20260906120000_audit_logs_append_only), so
 * `prisma.auditLog.deleteMany()` now fails by design — that is the protection
 * working.
 *
 * Tests still need a way to reset between suites, and the alternative — a
 * "maintenance mode" flag the trigger consults — would be a production backdoor
 * reachable from application code. Instead we use TRUNCATE, which:
 *   - does not fire row-level DELETE triggers (deliberate, documented in the
 *     migration),
 *   - requires table-owner privileges,
 *   - has no Prisma Client equivalent, so it is unreachable from ordinary
 *     application code and can only be issued as raw SQL from test/ops tooling.
 *
 * Immutability in production is therefore untouched.
 */
export async function purgeAuditLogs(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"');
}

/**
 * Phase 7 queue rows. `queue_token_events` carries the same append-only
 * triggers as audit_logs (migration 20260907110000_phase7_queue_tokens), so
 * it is TRUNCATEd for the same reasons; tokens and counters are ordinary rows
 * that must go before the customers/tables/branches/users they reference.
 */
export async function purgeQueueHistory(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "queue_token_events"');
  await prisma.queueToken.deleteMany();
  await prisma.queueCounter.deleteMany();
}

/**
 * Phase 8 banquet rows. `banquet_payments` carries the same append-only
 * triggers as audit_logs and queue_token_events (migration
 * 20260907120000_phase8_banquet), so it is TRUNCATEd for the same reasons;
 * the rest are ordinary rows that must go before the customers, halls,
 * branches and users they reference.
 */
export async function purgeBanquet(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "banquet_payments"');
  await prisma.banquetEventPlan.deleteMany();
  await prisma.banquetBookingItem.deleteMany();
  await prisma.banquetBooking.deleteMany();
  await prisma.banquetHall.deleteMany();
  await prisma.banquetPackageItem.deleteMany();
  await prisma.banquetPackage.deleteMany();
}

/**
 * Full reset in foreign-key-safe order.
 *
 * Every FK into companies/branches/users is ON DELETE RESTRICT (correct for
 * production — audit history is never cascade-deleted), so audit_logs must be
 * cleared before any row it references.
 *
 * `permissions` is intentionally NOT cleared: it is system-defined reference
 * data owned by `prisma db seed`, not per-test fixture data.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await purgeAuditLogs(prisma);
  await purgeQueueHistory(prisma);
  await purgeBanquet(prisma);
  await prisma.userBranchRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.companyMembership.deleteMany();
  await prisma.role.deleteMany();
  // T0-A foundations reference branches/companies with ON DELETE RESTRICT,
  // so they go before their parents.
  await prisma.displayDevice.deleteMany();
  await prisma.table.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
}

/**
 * Delete a user together with everything that references them.
 *
 * `users.create` now provisions an ACTIVE CompanyMembership alongside the user
 * (finding L5 — a company-scoped permission must not mint orphaned global
 * accounts), and every FK into users is ON DELETE RESTRICT, so tests can no
 * longer delete a created user directly.
 *
 * NOTE: this purges the whole audit table. `audit_logs.user_id` is an
 * ON DELETE RESTRICT foreign key and audit rows are immutable, so a user who
 * has ever authenticated cannot be deleted while their audit records exist, and
 * TRUNCATE is table-wide by nature. Assert on audit content BEFORE calling this.
 */
export async function deleteUserCascade(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  await purgeAuditLogs(prisma);
  await purgeQueueHistory(prisma);
  await purgeBanquet(prisma);
  await prisma.userBranchRole.deleteMany({ where: { user_id: userId } });
  await prisma.userSession.deleteMany({ where: { user_id: userId } });
  await prisma.companyMembership.deleteMany({ where: { user_id: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

/**
 * Fails fast with an actionable message if the system permission catalogue has
 * not been seeded. Every E2E suite builds roles from these rows, and without
 * them the failure surfaces as an opaque null dereference on `permMap.get(...)!`
 * rather than "you forgot to run the seed".
 */
export async function assertPermissionsSeeded(prisma: PrismaService): Promise<void> {
  const count = await prisma.permission.count();
  if (count === 0) {
    throw new Error(
      'No Permission rows found. E2E suites require the system permission catalogue. ' +
        'Run:  npm run db:seed  (from packages/database: npx prisma db seed)',
    );
  }
}
