-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "conversion_qty" DECIMAL(12,3),
ADD COLUMN     "hsn" VARCHAR(16),
ADD COLUMN     "purchase_price_minor" INTEGER,
ADD COLUMN     "purchase_unit" VARCHAR(24),
ADD COLUMN     "short_code" VARCHAR(40),
ADD COLUMN     "sub_category" VARCHAR(80),
ADD COLUMN     "tax_rate_bps" INTEGER,
ADD COLUMN     "transfer_price_minor" INTEGER;

-- Prices and tax are never negative; a conversion multiplies by something.
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_prices_nonnegative" CHECK (
  COALESCE("purchase_price_minor", 0) >= 0 AND COALESCE("transfer_price_minor", 0) >= 0 AND COALESCE("tax_rate_bps", 0) >= 0
);
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_conversion_positive" CHECK ("conversion_qty" IS NULL OR "conversion_qty" > 0);
