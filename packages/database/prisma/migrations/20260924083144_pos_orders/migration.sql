-- CreateEnum
CREATE TYPE "PosOrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'CARD', 'UPI', 'WALLET', 'OTHER');

-- CreateTable
CREATE TABLE "pos_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_number" VARCHAR(40) NOT NULL,
    "order_type" "PosOrderType" NOT NULL,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'OPEN',
    "table_label" VARCHAR(60),
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pos_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "line_total_minor" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pos_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "PosPaymentMethod" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pos_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_orders_branch_id_opened_at_idx" ON "pos_orders"("branch_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_branch_id_order_number_key" ON "pos_orders"("branch_id", "order_number");

-- CreateIndex
CREATE INDEX "pos_order_items_order_id_idx" ON "pos_order_items"("order_id");

-- CreateIndex
CREATE INDEX "pos_payments_order_id_idx" ON "pos_payments"("order_id");

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pos_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pos_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards the service cannot forget: money never negative, a quantity is at
-- least one, and a paid or cancelled order says when.
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_total_nonnegative" CHECK ("total_minor" >= 0);
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_paid_has_time" CHECK ("status" <> 'PAID' OR "paid_at" IS NOT NULL);
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_cancelled_has_time" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_money_nonnegative" CHECK ("unit_price_minor" >= 0 AND "line_total_minor" >= 0);
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_amount_positive" CHECK ("amount_minor" > 0);
