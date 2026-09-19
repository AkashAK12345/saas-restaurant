-- AlterEnum
ALTER TYPE "ChecklistItemKind" ADD VALUE 'PHOTO';

-- AlterTable
ALTER TABLE "checklist_template_items" ADD COLUMN     "section" VARCHAR(80);

-- AlterTable
ALTER TABLE "task_checklist_items" ADD COLUMN     "section" VARCHAR(80);

-- CreateTable
CREATE TABLE "task_checklist_item_photos" (
    "id" UUID NOT NULL,
    "checklist_item_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(255),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_checklist_item_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_checklist_item_photos_checklist_item_id_idx" ON "task_checklist_item_photos"("checklist_item_id");

-- AddForeignKey
ALTER TABLE "task_checklist_item_photos" ADD CONSTRAINT "task_checklist_item_photos_checklist_item_id_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "task_checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
