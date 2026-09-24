-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "source" VARCHAR(24) NOT NULL DEFAULT 'MANUAL';
