-- Phase 7 (Queue Management), first bounded step: queue token domain.
--
-- Additive only. Introduces queue_tokens, queue_token_events and
-- queue_counters. Existing tables are untouched; the Prisma-side relation
-- lists added to Company/Branch/Customer/Table/User produce no SQL.
--
-- Two pieces of raw SQL follow the generated DDL, both PostgreSQL-enforced
-- guarantees that Prisma's schema language cannot express:
--
--   1. queue_tokens_one_seated_party_per_table — a PARTIAL unique index so
--      that at most one SEATED token can hold a given table at a time. Two
--      operators seating different parties on the same table concurrently
--      cannot both commit; the loser gets a unique violation, which the
--      service maps to 409. Application pre-checks alone would race.
--
--   2. Append-only triggers on queue_token_events, mirroring the audit_logs
--      protection (migration 20260906120000): the lifecycle history of a
--      token can be read and appended, never rewritten. TRUNCATE remains the
--      single test-reset path for the same reasons documented there.

-- CreateEnum
CREATE TYPE "QueueTokenStatus" AS ENUM ('WAITING', 'CALLED', 'SEATED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueTokenEventType" AS ENUM ('REGISTERED', 'CALLED', 'SEATED', 'NO_SHOW', 'CANCELLED', 'TABLE_ASSIGNED', 'TABLE_RELEASED');

-- CreateTable
CREATE TABLE "queue_tokens" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID,
    "service_date" DATE NOT NULL,
    "token_number" INTEGER NOT NULL,
    "status" "QueueTokenStatus" NOT NULL DEFAULT 'WAITING',
    "party_size" INTEGER NOT NULL,
    "assigned_table_id" UUID,
    "called_at" TIMESTAMPTZ(3),
    "seated_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "no_show_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "queue_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_token_events" (
    "id" UUID NOT NULL,
    "queue_token_id" UUID NOT NULL,
    "event_type" "QueueTokenEventType" NOT NULL,
    "previous_status" "QueueTokenStatus",
    "new_status" "QueueTokenStatus" NOT NULL,
    "actor_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_token_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_counters" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "queue_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queue_tokens_branch_id_service_date_status_idx" ON "queue_tokens"("branch_id", "service_date", "status");

-- CreateIndex
CREATE INDEX "queue_tokens_company_id_idx" ON "queue_tokens"("company_id");

-- CreateIndex
CREATE INDEX "queue_tokens_customer_id_idx" ON "queue_tokens"("customer_id");

-- CreateIndex
CREATE INDEX "queue_tokens_assigned_table_id_idx" ON "queue_tokens"("assigned_table_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tokens_branch_id_service_date_token_number_key" ON "queue_tokens"("branch_id", "service_date", "token_number");

-- CreateIndex
CREATE INDEX "queue_token_events_queue_token_id_created_at_idx" ON "queue_token_events"("queue_token_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_counters_branch_id_service_date_key" ON "queue_counters"("branch_id", "service_date");

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_assigned_table_id_fkey" FOREIGN KEY ("assigned_table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_token_events" ADD CONSTRAINT "queue_token_events_queue_token_id_fkey" FOREIGN KEY ("queue_token_id") REFERENCES "queue_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_token_events" ADD CONSTRAINT "queue_token_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_counters" ADD CONSTRAINT "queue_counters_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL 1: table exclusivity (partial unique index)
-- ---------------------------------------------------------------------------
-- Only SEATED tokens occupy a table. Rows with a NULL assigned_table_id never
-- collide (unique indexes treat NULLs as distinct), and tokens in any other
-- status do not participate in the index at all, so a released or finished
-- token frees the table without losing which table it had.
CREATE UNIQUE INDEX "queue_tokens_one_seated_party_per_table"
  ON "queue_tokens" ("assigned_table_id")
  WHERE "status" = 'SEATED' AND "assigned_table_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Raw SQL 2: queue_token_events is append-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION samco_queue_token_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'queue_token_events is append-only: % is not permitted on queue history', TG_OP
    USING ERRCODE = '0A000'; -- feature_not_supported
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS queue_token_events_reject_update ON "queue_token_events";
CREATE TRIGGER queue_token_events_reject_update
  BEFORE UPDATE ON "queue_token_events"
  FOR EACH ROW
  EXECUTE FUNCTION samco_queue_token_events_immutable();

DROP TRIGGER IF EXISTS queue_token_events_reject_delete ON "queue_token_events";
CREATE TRIGGER queue_token_events_reject_delete
  BEFORE DELETE ON "queue_token_events"
  FOR EACH ROW
  EXECUTE FUNCTION samco_queue_token_events_immutable();
