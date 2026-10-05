-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_owner" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "password_reset_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_codes_user_id_created_at_idx" ON "password_reset_codes"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A code is tried at most five times.
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_attempts_range" CHECK ("attempts" BETWEEN 0 AND 5);
