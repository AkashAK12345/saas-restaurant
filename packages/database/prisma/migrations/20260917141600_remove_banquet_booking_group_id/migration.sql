-- The "link another hall" feature is removed: a customer no longer groups
-- bookings across halls for the same event.
-- DropIndex
DROP INDEX "banquet_bookings_group_id_idx";

-- AlterTable
ALTER TABLE "banquet_bookings" DROP COLUMN "group_id";
