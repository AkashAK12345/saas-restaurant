-- Queue: scheduled advance bookings and skipping a called party.
--
-- ADDITIVE. Enum values are appended (never reordered), two columns are added
-- with safe defaults, and existing tokens are untouched: every existing row
-- keeps its status, and none has ever been skipped.
--
-- The new enum values are not USED in this migration (PostgreSQL does not
-- allow a value added in a transaction to be referenced in that transaction).

ALTER TYPE "QueueTokenStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

ALTER TYPE "QueueTokenEventType" ADD VALUE IF NOT EXISTS 'SKIPPED';
ALTER TYPE "QueueTokenEventType" ADD VALUE IF NOT EXISTS 'CHECKED_IN';
ALTER TYPE "QueueTokenEventType" ADD VALUE IF NOT EXISTS 'ACTIVATED';

-- AlterTable
ALTER TABLE "queue_tokens"
  ADD COLUMN "skipped_at" TIMESTAMPTZ(3),
  ADD COLUMN "skip_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "queue_tokens_status_advance_booking_at_idx" ON "queue_tokens"("status", "advance_booking_at");

-- A skip count is a count.
ALTER TABLE "queue_tokens"
  ADD CONSTRAINT "queue_tokens_skip_count_non_negative"
  CHECK ("skip_count" >= 0);
