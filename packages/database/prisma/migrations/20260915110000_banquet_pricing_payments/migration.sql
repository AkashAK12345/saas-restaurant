-- Banquet conformance: layered pricing, GST, payment stages and verification,
-- hall slots, hall-name snapshot and cancellation reason.
--
-- Additive only. Every new booking column has a default that preserves the
-- meaning of existing rows: extra_pax 0 and gst_rate_bps 0 leave an existing
-- total exactly as it was, and paid_minor is backfilled from the payment
-- history that already exists.
--
-- Raw SQL after the generated DDL expresses what Prisma's schema language
-- cannot:
--
--  1. Backfills: hall_name from the hall as it stands now (the best truth
--     available for rows written before the snapshot existed) and paid_minor
--     from banquet_payments.
--  2. CHECK constraints. The important one is
--     banquet_bookings_paid_within_total: whatever writes the row, recorded
--     money can never exceed the booking total, so an overpayment — or an edit
--     or discount that would push the total below what was already paid — is
--     refused by the database itself.
--  3. Append-only triggers for banquet_booking_adjustments and
--     banquet_payment_verifications, the same pattern as banquet_payments.
--     A withdrawn discount is a new reversing row, never an UPDATE.

-- CreateEnum
CREATE TYPE "BanquetAdjustmentKind" AS ENUM ('EXTRA_CHARGE', 'LINE_DISCOUNT', 'PER_HEAD_DISCOUNT', 'ADMIN_DISCOUNT');

-- CreateEnum
CREATE TYPE "BanquetPaymentKind" AS ENUM ('ADVANCE', 'INTERIM', 'FINAL');

-- AlterTable
ALTER TABLE "banquet_bookings" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "extra_pax" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hall_name" TEXT,
ADD COLUMN     "paid_minor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "banquet_payments" ADD COLUMN     "kind" "BanquetPaymentKind";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "banquet_gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fssai_license" TEXT,
ADD COLUMN     "gstin" TEXT;

-- CreateTable
CREATE TABLE "banquet_hall_slots" (
    "id" UUID NOT NULL,
    "hall_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "BanquetHallStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_hall_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_booking_adjustments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" "BanquetAdjustmentKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reverses_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banquet_booking_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_payment_verifications" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "note" TEXT,
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banquet_payment_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banquet_hall_slots_hall_id_idx" ON "banquet_hall_slots"("hall_id");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_hall_slots_hall_id_name_key" ON "banquet_hall_slots"("hall_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_booking_adjustments_reverses_id_key" ON "banquet_booking_adjustments"("reverses_id");

-- CreateIndex
CREATE INDEX "banquet_booking_adjustments_booking_id_created_at_idx" ON "banquet_booking_adjustments"("booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_payment_verifications_payment_id_key" ON "banquet_payment_verifications"("payment_id");

-- AddForeignKey
ALTER TABLE "banquet_hall_slots" ADD CONSTRAINT "banquet_hall_slots_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "banquet_halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_booking_adjustments" ADD CONSTRAINT "banquet_booking_adjustments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "banquet_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_booking_adjustments" ADD CONSTRAINT "banquet_booking_adjustments_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_booking_adjustments" ADD CONSTRAINT "banquet_booking_adjustments_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "banquet_booking_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_payment_verifications" ADD CONSTRAINT "banquet_payment_verifications_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "banquet_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_payment_verifications" ADD CONSTRAINT "banquet_payment_verifications_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL 1: backfills
-- ---------------------------------------------------------------------------
UPDATE "banquet_bookings" b
SET "hall_name" = h."name"
FROM "banquet_halls" h
WHERE h."id" = b."hall_id" AND b."hall_name" IS NULL;

UPDATE "banquet_bookings" b
SET "paid_minor" = s."paid"
FROM (
  SELECT "booking_id", SUM("amount_minor")::integer AS "paid"
  FROM "banquet_payments"
  GROUP BY "booking_id"
) s
WHERE s."booking_id" = b."id";

-- ---------------------------------------------------------------------------
-- Raw SQL 2: CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "banquet_bookings"
  ADD CONSTRAINT "banquet_bookings_extra_pax_nonnegative" CHECK ("extra_pax" >= 0),
  ADD CONSTRAINT "banquet_bookings_gst_rate_range" CHECK ("gst_rate_bps" BETWEEN 0 AND 2800),
  ADD CONSTRAINT "banquet_bookings_total_nonnegative" CHECK ("total_amount_minor" >= 0),
  ADD CONSTRAINT "banquet_bookings_paid_within_total"
    CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_amount_minor"),
  ADD CONSTRAINT "banquet_bookings_cancellation_reason_length"
    CHECK ("cancellation_reason" IS NULL OR char_length("cancellation_reason") BETWEEN 1 AND 500);

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_banquet_gst_rate_range" CHECK ("banquet_gst_rate_bps" BETWEEN 0 AND 2800),
  -- 2-digit state code + PAN + entity + 'Z' + checksum: 15 upper-case alphanumerics.
  ADD CONSTRAINT "branches_gstin_shape" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  ADD CONSTRAINT "branches_fssai_shape" CHECK ("fssai_license" IS NULL OR "fssai_license" ~ '^[0-9]{14}$');

ALTER TABLE "banquet_hall_slots"
  ADD CONSTRAINT "banquet_hall_slots_time_shape" CHECK (
    "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  ADD CONSTRAINT "banquet_hall_slots_nonempty_window" CHECK ("start_time" <> "end_time"),
  ADD CONSTRAINT "banquet_hall_slots_name_length" CHECK (char_length("name") BETWEEN 1 AND 60);

ALTER TABLE "banquet_booking_adjustments"
  ADD CONSTRAINT "banquet_booking_adjustments_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "banquet_booking_adjustments_description_length"
    CHECK (char_length("description") BETWEEN 1 AND 200),
  ADD CONSTRAINT "banquet_booking_adjustments_not_self_reversing"
    CHECK ("reverses_id" IS NULL OR "reverses_id" <> "id");

-- ---------------------------------------------------------------------------
-- Raw SQL 3: append-only adjustments and verifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION samco_banquet_adjustments_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'banquet_booking_adjustments is append-only: % is not permitted; record a reversing line instead', TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS banquet_booking_adjustments_reject_update ON "banquet_booking_adjustments";
CREATE TRIGGER banquet_booking_adjustments_reject_update
  BEFORE UPDATE ON "banquet_booking_adjustments"
  FOR EACH ROW
  EXECUTE FUNCTION samco_banquet_adjustments_immutable();

DROP TRIGGER IF EXISTS banquet_booking_adjustments_reject_delete ON "banquet_booking_adjustments";
CREATE TRIGGER banquet_booking_adjustments_reject_delete
  BEFORE DELETE ON "banquet_booking_adjustments"
  FOR EACH ROW
  EXECUTE FUNCTION samco_banquet_adjustments_immutable();

CREATE OR REPLACE FUNCTION samco_banquet_payment_verifications_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'banquet_payment_verifications is append-only: % is not permitted', TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS banquet_payment_verifications_reject_update ON "banquet_payment_verifications";
CREATE TRIGGER banquet_payment_verifications_reject_update
  BEFORE UPDATE ON "banquet_payment_verifications"
  FOR EACH ROW
  EXECUTE FUNCTION samco_banquet_payment_verifications_immutable();

DROP TRIGGER IF EXISTS banquet_payment_verifications_reject_delete ON "banquet_payment_verifications";
CREATE TRIGGER banquet_payment_verifications_reject_delete
  BEFORE DELETE ON "banquet_payment_verifications"
  FOR EACH ROW
  EXECUTE FUNCTION samco_banquet_payment_verifications_immutable();
