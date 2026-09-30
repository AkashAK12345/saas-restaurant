-- AlterEnum
ALTER TYPE "QueueTokenEventType" ADD VALUE 'FINISHED';

-- AlterTable
ALTER TABLE "queue_tokens" ADD COLUMN     "finished_at" TIMESTAMPTZ(3);

-- Only a seated party can leave, and one that has left holds no table.
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_finished_seated" CHECK ("finished_at" IS NULL OR ("status" = 'SEATED' AND "assigned_table_id" IS NULL));

-- Parties whose table was already cleared have left: when it was last cleared.
UPDATE "queue_tokens" t
SET "finished_at" = e."last_released"
FROM (
  SELECT "queue_token_id", MAX("created_at") AS "last_released"
  FROM "queue_token_events"
  WHERE "event_type" = 'TABLE_RELEASED'
  GROUP BY "queue_token_id"
) e
WHERE e."queue_token_id" = t."id" AND t."status" = 'SEATED' AND t."assigned_table_id" IS NULL;
