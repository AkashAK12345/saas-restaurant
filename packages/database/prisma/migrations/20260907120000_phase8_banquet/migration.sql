-- Phase 8 (Banquet Management): halls, packages, bookings, event plans and
-- payments.
--
-- Additive only. No existing table is altered; the Prisma-side relation lists
-- added to User/Company/Branch/Customer produce no SQL.
--
-- Three pieces of raw SQL follow the generated DDL, each expressing a
-- guarantee Prisma's schema language cannot:
--
--  1. btree_gist + an EXCLUSION CONSTRAINT so one hall cannot hold two
--     overlapping bookings. An application check alone would race: two
--     concurrent confirmations can both read "no conflict" and both commit.
--     The constraint makes that physically impossible.
--
--       - Ranges are HALF-OPEN, tstzrange(starts_at, ends_at, '[)'), so a
--         booking ending at 14:00 and one starting at 14:00 do NOT conflict.
--       - It applies only WHERE status IN ('CONFIRMED','COMPLETED'). A DRAFT
--         is a tentative enquiry that blocks nobody; confirming is what claims
--         the hall, and cancelling releases it.
--       - tstzrange operates on absolute instants, so the rule is DST-proof:
--         no wall-clock arithmetic is involved anywhere.
--     btree_gist is required because the constraint mixes uuid equality with
--     range overlap in one GiST index.
--
--  2. A CHECK that ends_at is strictly after starts_at, so a reversed or
--     zero-length event cannot exist even if inserted outside the service.
--
--  3. Append-only triggers on banquet_payments, mirroring audit_logs
--     (20260906120000) and queue_token_events (20260907110000): payment
--     history can be read and appended, never rewritten. TRUNCATE remains the
--     single sanctioned test-reset path for the reasons documented there.

-- Required by the exclusion constraint below (uuid equality inside a GiST index).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "BanquetHallStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BanquetPackageStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BanquetBookingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BanquetKdsStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'READY');

-- CreateTable
CREATE TABLE "banquet_halls" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "BanquetHallStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_halls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_packages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_per_guest_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BanquetPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_package_items" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_bookings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "hall_id" UUID NOT NULL,
    "package_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "guest_count" INTEGER NOT NULL,
    "status" "BanquetBookingStatus" NOT NULL DEFAULT 'DRAFT',
    "package_name" TEXT NOT NULL,
    "price_per_guest_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_amount_minor" INTEGER NOT NULL,
    "notes" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_booking_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kds_status" "BanquetKdsStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_event_plans" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "service_at" TIMESTAMPTZ(3),
    "setup_notes" TEXT,
    "kitchen_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banquet_event_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banquet_payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banquet_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banquet_halls_branch_id_idx" ON "banquet_halls"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_halls_branch_id_name_key" ON "banquet_halls"("branch_id", "name");

-- CreateIndex
CREATE INDEX "banquet_packages_company_id_idx" ON "banquet_packages"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_packages_company_id_name_key" ON "banquet_packages"("company_id", "name");

-- CreateIndex
CREATE INDEX "banquet_package_items_package_id_idx" ON "banquet_package_items"("package_id");

-- CreateIndex
CREATE INDEX "banquet_bookings_branch_id_starts_at_idx" ON "banquet_bookings"("branch_id", "starts_at");

-- CreateIndex
CREATE INDEX "banquet_bookings_branch_id_status_idx" ON "banquet_bookings"("branch_id", "status");

-- CreateIndex
CREATE INDEX "banquet_bookings_company_id_idx" ON "banquet_bookings"("company_id");

-- CreateIndex
CREATE INDEX "banquet_bookings_customer_id_idx" ON "banquet_bookings"("customer_id");

-- CreateIndex
CREATE INDEX "banquet_bookings_hall_id_idx" ON "banquet_bookings"("hall_id");

-- CreateIndex
CREATE INDEX "banquet_booking_items_booking_id_idx" ON "banquet_booking_items"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "banquet_event_plans_booking_id_key" ON "banquet_event_plans"("booking_id");

-- CreateIndex
CREATE INDEX "banquet_payments_booking_id_paid_at_idx" ON "banquet_payments"("booking_id", "paid_at");

-- AddForeignKey
ALTER TABLE "banquet_halls" ADD CONSTRAINT "banquet_halls_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_packages" ADD CONSTRAINT "banquet_packages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_package_items" ADD CONSTRAINT "banquet_package_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "banquet_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_bookings" ADD CONSTRAINT "banquet_bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_bookings" ADD CONSTRAINT "banquet_bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_bookings" ADD CONSTRAINT "banquet_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_bookings" ADD CONSTRAINT "banquet_bookings_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "banquet_halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_bookings" ADD CONSTRAINT "banquet_bookings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "banquet_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_booking_items" ADD CONSTRAINT "banquet_booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "banquet_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_event_plans" ADD CONSTRAINT "banquet_event_plans_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "banquet_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_payments" ADD CONSTRAINT "banquet_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "banquet_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banquet_payments" ADD CONSTRAINT "banquet_payments_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL 1: an event must end after it starts
-- ---------------------------------------------------------------------------
ALTER TABLE "banquet_bookings"
  ADD CONSTRAINT "banquet_bookings_time_order"
  CHECK ("ends_at" > "starts_at");

-- ---------------------------------------------------------------------------
-- Raw SQL 2: one hall cannot hold two overlapping live bookings
-- ---------------------------------------------------------------------------
ALTER TABLE "banquet_bookings"
  ADD CONSTRAINT "banquet_bookings_hall_no_overlap"
  EXCLUDE USING gist (
    "hall_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('CONFIRMED', 'COMPLETED'));

-- ---------------------------------------------------------------------------
-- Raw SQL 3: banquet_payments is append-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION samco_banquet_payments_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'banquet_payments is append-only: % is not permitted on payment history', TG_OP
    USING ERRCODE = '0A000'; -- feature_not_supported
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS banquet_payments_reject_update ON "banquet_payments";
CREATE TRIGGER banquet_payments_reject_update
  BEFORE UPDATE ON "banquet_payments"
  FOR EACH ROW
  EXECUTE FUNCTION samco_banquet_payments_immutable();

DROP TRIGGER IF EXISTS banquet_payments_reject_delete ON "banquet_payments";
CREATE TRIGGER banquet_payments_reject_delete
  BEFORE DELETE ON "banquet_payments"
  FOR EACH ROW
  EXECUTE FUNCTION samco_banquet_payments_immutable();
