-- AlterTable
ALTER TABLE "banquet_bookings" ADD COLUMN     "group_id" UUID;

-- CreateIndex
CREATE INDEX "banquet_bookings_group_id_idx" ON "banquet_bookings"("group_id");
