-- Phase 10 — reporting indexes.
--
-- ADDITIVE ONLY: two indexes, no column, table, constraint or data touched.
-- Both exist because a Phase 10 report reads a range that no existing index
-- covers, and both were verified against the queries that need them rather
-- than added speculatively:
--
--   banquet_payments(branch_id, paid_at)
--     `banquet.payments` filters one branch over a date window. The table's
--     only index is (booking_id, paid_at), which cannot serve a branch-wide
--     scan, so the report degraded to a full scan of every payment ever taken.
--
--   tasks(branch_id, created_at)
--     Every task report groups one branch's tasks by the period they were
--     raised in. tasks already indexes (branch_id, status) and
--     (branch_id, due_at); neither helps a created_at range scan.
--
-- The queue reports deliberately get NO new index: they filter on
-- (branch_id, service_date, status), which queue_tokens already carries.
--
-- CONCURRENTLY is not used: Prisma migrations run inside a transaction, and
-- these tables are small enough at this stage that a brief lock is correct.

CREATE INDEX "banquet_payments_branch_id_paid_at_idx"
  ON "banquet_payments" ("branch_id", "paid_at");

CREATE INDEX "tasks_branch_id_created_at_idx"
  ON "tasks" ("branch_id", "created_at");
