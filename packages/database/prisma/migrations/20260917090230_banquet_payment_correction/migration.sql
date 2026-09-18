-- Correcting a mistaken payment without ever UPDATEing a row the
-- banquet_payments_reject_update/delete triggers protect: this adds a
-- self-referencing reverses_id, the same append-only correction pattern
-- banquet_booking_adjustments already uses for "withdraw".

-- AlterTable
ALTER TABLE "banquet_payments" ADD COLUMN     "reverses_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "banquet_payments_reverses_id_key" ON "banquet_payments"("reverses_id");

-- AddForeignKey
ALTER TABLE "banquet_payments" ADD CONSTRAINT "banquet_payments_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "banquet_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payment can never reverse itself, mirroring the same guard on adjustments.
ALTER TABLE "banquet_payments"
  ADD CONSTRAINT "banquet_payments_reverses_not_self" CHECK ("reverses_id" IS NULL OR "reverses_id" <> "id");
