-- CreateTable
CREATE TABLE "purchase_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "payment_mode" VARCHAR(16) NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_payments_vendor_id_paid_at_idx" ON "purchase_payments"("vendor_id", "paid_at");

-- CreateIndex
CREATE INDEX "purchase_payments_receipt_id_idx" ON "purchase_payments"("receipt_id");

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the service cannot forget: a payment pays something, in a mode the app knows.
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_mode" CHECK ("payment_mode" IN ('CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE'));

-- What was paid before payments were dated becomes a payment of its own.
-- 1. Paid on receiving: dated when the delivery arrived.
INSERT INTO "purchase_payments" ("id", "company_id", "vendor_id", "branch_id", "purchase_order_id", "receipt_id",
                                 "amount_minor", "payment_mode", "paid_at", "created_by", "created_at")
SELECT gen_random_uuid(), po."company_id", po."vendor_id", r."branch_id", po."id", r."id",
       r."paid_minor", COALESCE(r."payment_mode", 'CASH'), r."received_at", r."received_by", CURRENT_TIMESTAMP
FROM "purchase_receipts" r
JOIN "purchase_orders" po ON po."id" = r."purchase_order_id"
WHERE r."paid_minor" > 0;

-- 2. Marked paid in full later: the rest of each delivery, dated when it was marked.
INSERT INTO "purchase_payments" ("id", "company_id", "vendor_id", "branch_id", "purchase_order_id", "receipt_id",
                                 "amount_minor", "payment_mode", "paid_at", "created_by", "created_at")
SELECT gen_random_uuid(), po."company_id", po."vendor_id", r."branch_id", po."id", r."id",
       r."total_minor" - r."paid_minor", COALESCE(po."payment_mode", 'CASH'), po."paid_at", NULL, CURRENT_TIMESTAMP
FROM "purchase_receipts" r
JOIN "purchase_orders" po ON po."id" = r."purchase_order_id"
WHERE po."paid_at" IS NOT NULL AND r."total_minor" > r."paid_minor";

UPDATE "purchase_receipts" r
SET "paid_minor" = r."total_minor"
FROM "purchase_orders" po
WHERE po."id" = r."purchase_order_id" AND po."paid_at" IS NOT NULL;
