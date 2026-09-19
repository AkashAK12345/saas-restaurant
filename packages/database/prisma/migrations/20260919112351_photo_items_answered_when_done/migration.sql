-- PHOTO items are "answered" by their attached photos (TaskChecklistItemPhoto),
-- never by the `value` column — the same shape as CHECK, just for a different
-- reason. Widen the two constraints written for CHECK alone to cover PHOTO too.

ALTER TABLE "task_checklist_items"
  DROP CONSTRAINT "task_checklist_items_check_has_no_value",
  DROP CONSTRAINT "task_checklist_items_answered_when_done";

ALTER TABLE "task_checklist_items"
  ADD CONSTRAINT "task_checklist_items_check_has_no_value"
    CHECK ("kind" NOT IN ('CHECK', 'PHOTO') OR "value" IS NULL),
  ADD CONSTRAINT "task_checklist_items_answered_when_done"
    CHECK ("kind" IN ('CHECK', 'PHOTO') OR ("is_done" = ("value" IS NOT NULL)));
