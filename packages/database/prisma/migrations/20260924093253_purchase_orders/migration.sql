-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('ORDERED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "po_number" VARCHAR(40) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "ordered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whatsapp_sent_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(16),
    "unit_price_minor" INTEGER NOT NULL,
    "line_total_minor" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_company_id_name_key" ON "vendors"("company_id", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_branch_id_ordered_at_idx" ON "purchase_orders"("branch_id", "ordered_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_branch_id_po_number_key" ON "purchase_orders"("branch_id", "po_number");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the service cannot forget: money never negative, a quantity above
-- zero, and a received or cancelled order says when.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_nonnegative" CHECK ("total_minor" >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_received_has_time" CHECK ("status" <> 'RECEIVED' OR "received_at" IS NOT NULL);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_has_time" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_money_nonnegative" CHECK ("unit_price_minor" >= 0 AND "line_total_minor" >= 0);
