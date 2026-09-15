-- Typed checklist items: the reference routines capture numbers (meter
-- readings, KG balances), ratings, dates and free text, not only ticks.
-- Additive: every existing item becomes a CHECK, exactly what it already was.

-- CreateEnum
CREATE TYPE "ChecklistItemKind" AS ENUM ('CHECK', 'NUMBER', 'TEXT', 'RATING', 'DATE');

-- AlterTable
ALTER TABLE "checklist_template_items" ADD COLUMN     "kind" "ChecklistItemKind" NOT NULL DEFAULT 'CHECK';

-- AlterTable
ALTER TABLE "task_checklist_items" ADD COLUMN     "kind" "ChecklistItemKind" NOT NULL DEFAULT 'CHECK',
ADD COLUMN     "value" TEXT;

-- An answer belongs to an answered, non-CHECK item; a tick carries none.
-- The service canonicalises values; these are the backstops.
ALTER TABLE "task_checklist_items"
  ADD CONSTRAINT "task_checklist_items_value_length" CHECK ("value" IS NULL OR char_length("value") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "task_checklist_items_check_has_no_value" CHECK ("kind" <> 'CHECK' OR "value" IS NULL),
  ADD CONSTRAINT "task_checklist_items_answered_when_done"
    CHECK ("kind" = 'CHECK' OR ("is_done" = ("value" IS NOT NULL)));
