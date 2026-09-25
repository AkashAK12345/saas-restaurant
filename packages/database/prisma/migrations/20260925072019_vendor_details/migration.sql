-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" VARCHAR(80),
ADD COLUMN     "email" VARCHAR(160),
ADD COLUMN     "fssai_no" VARCHAR(20),
ADD COLUMN     "gst_registered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gstin" VARCHAR(20),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "label" VARCHAR(80),
ADD COLUMN     "pan" VARCHAR(12),
ADD COLUMN     "pincode" VARCHAR(10),
ADD COLUMN     "state" VARCHAR(80),
ADD COLUMN     "tcs_rate_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" VARCHAR(16) NOT NULL DEFAULT 'PURCHASE';

ALTER TABLE "vendors" ADD CONSTRAINT "vendors_type_known" CHECK ("type" IN ('PURCHASE', 'SALE', 'BOTH'));
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tcs_in_range" CHECK ("tcs_rate_bps" BETWEEN 0 AND 10000);
