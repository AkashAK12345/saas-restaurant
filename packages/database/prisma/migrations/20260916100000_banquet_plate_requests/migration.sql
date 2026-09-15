-- Plate approval for banquet service (SRS §5.3.5).
--
-- A new table only; nothing existing changes. The generated DDL is followed by
-- CHECK constraints that hold whatever writes the row:
--
--   plates_range          1 to 10,000 plates per request
--   decision_stamps       decided_by/decided_at are set exactly when the request
--                         has left REQUESTED
--   rejection_reason      a REJECTED request carries a non-blank reason, and no
--                         other status carries one
--   dispatch_stamps       dispatched_by/dispatched_at are set exactly when the
--                         plates were DISPATCHED
--   not_self_decided      nobody approves or rejects their own request
--   note_length /
--   reason_length         the API's 200-character limits

-- CreateEnum
CREATE TYPE "BanquetPlateRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'DISPATCHED');

-- CreateTable
CREATE TABLE "banquet_plate_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "plates" INTEGER NOT NULL,
    "note" TEXT,
    "status" "BanquetPlateRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_user_id" UUID NOT NULL,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "dispatched_by_user_id" UUID,
    "dispatched_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_plate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banquet_plate_requests_booking_id_idx" ON "banquet_plate_requests"("booking_id");

-- CreateIndex
CREATE INDEX "banquet_plate_requests_item_id_idx" ON "banquet_plate_requests"("item_id");

-- CreateIndex
CREATE INDEX "banquet_plate_requests_branch_id_status_idx" ON "banquet_plate_requests"("branch_id", "status");

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "banquet_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "banquet_booking_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_plate_requests" ADD CONSTRAINT "banquet_plate_requests_dispatched_by_user_id_fkey" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules (see header)
ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_plates_range"
  CHECK ("plates" BETWEEN 1 AND 10000);

ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_decision_stamps"
  CHECK (
    ("status" = 'REQUESTED' AND "decided_by_user_id" IS NULL AND "decided_at" IS NULL)
    OR ("status" <> 'REQUESTED' AND "decided_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  );

ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_rejection_reason"
  CHECK (
    ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL AND btrim("rejection_reason") <> '')
    OR ("status" <> 'REJECTED' AND "rejection_reason" IS NULL)
  );

ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_dispatch_stamps"
  CHECK (
    ("status" = 'DISPATCHED' AND "dispatched_by_user_id" IS NOT NULL AND "dispatched_at" IS NOT NULL)
    OR ("status" <> 'DISPATCHED' AND "dispatched_by_user_id" IS NULL AND "dispatched_at" IS NULL)
  );

ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_not_self_decided"
  CHECK ("decided_by_user_id" IS NULL OR "decided_by_user_id" <> "requested_by_user_id");

ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_note_length"
  CHECK ("note" IS NULL OR char_length("note") <= 200);

ALTER TABLE "banquet_plate_requests"
  ADD CONSTRAINT "banquet_plate_requests_reason_length"
  CHECK ("rejection_reason" IS NULL OR char_length("rejection_reason") <= 200);
