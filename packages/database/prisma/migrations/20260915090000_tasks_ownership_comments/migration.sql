-- Tasks: ownership tracking, reassignment count, routine deadlines and
-- append-only comments.
--
-- ADDITIVE. New nullable columns and one new table; nothing dropped, nothing
-- rewritten. Existing tasks keep created_by / assigned_by NULL — who raised
-- them was never recorded, and inventing it would falsify history.

-- AlterTable
ALTER TABLE "tasks"
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "assigned_by" UUID,
  ADD COLUMN "assigned_at" TIMESTAMPTZ(3),
  ADD COLUMN "reassignment_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "task_routines" ADD COLUMN "due_time" TEXT;

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_created_by_idx" ON "tasks"("created_by");

-- CreateIndex
CREATE INDEX "task_comments_task_id_created_at_idx" ON "task_comments"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL: invariants Prisma cannot express
-- ---------------------------------------------------------------------------

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_reassignment_count_non_negative"
  CHECK ("reassignment_count" >= 0);

-- A deadline is a 24-hour HH:MM wall clock, the same shape as time_of_day.
ALTER TABLE "task_routines"
  ADD CONSTRAINT "task_routines_due_time_shape"
  CHECK ("due_time" IS NULL OR "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- A comment says something: never blank, never a novel.
ALTER TABLE "task_comments"
  ADD CONSTRAINT "task_comments_body_length"
  CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000);

-- Append-only, exactly as audit_logs, queue_token_events and banquet_payments.
CREATE OR REPLACE FUNCTION samco_task_comments_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'task_comments is append-only: % is not permitted on task comments', TG_OP
    USING ERRCODE = '0A000'; -- feature_not_supported
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_comments_reject_update ON "task_comments";
CREATE TRIGGER task_comments_reject_update
  BEFORE UPDATE ON "task_comments"
  FOR EACH ROW
  EXECUTE FUNCTION samco_task_comments_immutable();

DROP TRIGGER IF EXISTS task_comments_reject_delete ON "task_comments";
CREATE TRIGGER task_comments_reject_delete
  BEFORE DELETE ON "task_comments"
  FOR EACH ROW
  EXECUTE FUNCTION samco_task_comments_immutable();
