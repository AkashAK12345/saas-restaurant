-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('OPENING', 'PURCHASE', 'CONSUMPTION', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "paid_minor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "inventory_categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "unit" VARCHAR(24) NOT NULL,
    "category_id" UUID,
    "department" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_company_id_name_key" ON "inventory_categories"("company_id", "name");

-- CreateIndex
CREATE INDEX "inventory_items_company_id_name_idx" ON "inventory_items"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_company_id_name_unit_key" ON "inventory_items"("company_id", "name", "unit");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_item_id_idx" ON "stock_movements"("branch_id", "item_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_occurred_at_idx" ON "stock_movements"("company_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards the service cannot forget: nothing is paid below zero or beyond the
-- order, and a movement moves something, in the direction its kind says.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_paid_in_range" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_minor");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  ("kind" IN ('OPENING', 'PURCHASE', 'TRANSFER_IN') AND "quantity" > 0)
  OR ("kind" IN ('CONSUMPTION', 'TRANSFER_OUT') AND "quantity" < 0)
  OR "kind" = 'ADJUSTMENT'
);
