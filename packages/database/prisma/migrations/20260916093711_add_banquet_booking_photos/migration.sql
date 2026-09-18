-- CreateTable
CREATE TABLE "banquet_booking_photos" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(255),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banquet_booking_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banquet_booking_photos_booking_id_idx" ON "banquet_booking_photos"("booking_id");

-- AddForeignKey
ALTER TABLE "banquet_booking_photos" ADD CONSTRAINT "banquet_booking_photos_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "banquet_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
