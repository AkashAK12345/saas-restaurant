-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "inventory_item_id" UUID,
ADD COLUMN     "tax_minor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate_bps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "created_by" UUID;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "purchase_order_id" UUID;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "bank_account_name" VARCHAR(120),
ADD COLUMN     "bank_account_number" VARCHAR(34),
ADD COLUMN     "bank_ifsc" VARCHAR(11),
ADD COLUMN     "bank_name" VARCHAR(120);

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tax_nonnegative" CHECK ("tax_rate_bps" >= 0 AND "tax_minor" >= 0);
