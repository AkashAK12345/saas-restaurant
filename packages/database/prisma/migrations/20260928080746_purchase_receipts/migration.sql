-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "receipt_id" UUID;

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_number" VARCHAR(40) NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "paid_minor" INTEGER NOT NULL DEFAULT 0,
    "payment_mode" VARCHAR(16),
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_photos" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "receipt_id" UUID,
    "data" BYTEA NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(255),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_receipts_purchase_order_id_idx" ON "purchase_receipts"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_branch_id_invoice_number_key" ON "purchase_receipts"("branch_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_order_photos_purchase_order_id_idx" ON "purchase_order_photos"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_photos" ADD CONSTRAINT "purchase_order_photos_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_photos" ADD CONSTRAINT "purchase_order_photos_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guards the service cannot forget: a receipt pays nothing below zero or
-- beyond itself, in a mode the app knows.
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_paid_in_range" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_minor" AND "total_minor" >= 0);
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_payment_mode" CHECK ("payment_mode" IS NULL OR "payment_mode" IN ('CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE'));
