-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_mode" VARCHAR(16);

-- A mode the app knows, or none.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_payment_mode" CHECK ("payment_mode" IS NULL OR "payment_mode" IN ('CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE'));
