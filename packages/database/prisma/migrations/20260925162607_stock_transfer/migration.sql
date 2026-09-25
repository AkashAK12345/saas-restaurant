-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "transfer_id" UUID;

-- CreateTable
CREATE TABLE "menu_products" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80),
    "unit" VARCHAR(24),
    "short_code" VARCHAR(40),
    "price_minor" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "note" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "menu_product_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "unit" VARCHAR(24),
    "quantity" DECIMAL(14,3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_products_company_id_name_key" ON "menu_products"("company_id", "name");

-- CreateIndex
CREATE INDEX "stock_transfers_company_id_created_at_idx" ON "stock_transfers"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_from_branch_id_number_key" ON "stock_transfers"("from_branch_id", "number");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_transfer_id_idx" ON "stock_transfer_lines"("transfer_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_products" ADD CONSTRAINT "menu_products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_menu_product_id_fkey" FOREIGN KEY ("menu_product_id") REFERENCES "menu_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards the service cannot forget: a transfer goes somewhere else, a line is
-- one thing (a raw material or a product) and moves something, and a transfer
-- movement belongs to a transfer.
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_elsewhere" CHECK ("from_branch_id" <> "to_branch_id");
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_one_thing" CHECK (("inventory_item_id" IS NULL) <> ("menu_product_id" IS NULL));
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_kind" CHECK ("transfer_id" IS NULL OR "kind" IN ('TRANSFER_IN', 'TRANSFER_OUT'));
ALTER TABLE "menu_products" ADD CONSTRAINT "menu_products_price_nonnegative" CHECK ("price_minor" IS NULL OR "price_minor" >= 0);
