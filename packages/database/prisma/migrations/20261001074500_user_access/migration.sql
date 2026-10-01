-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('ADMIN', 'MANAGER', 'STAFF');

-- AlterTable
ALTER TABLE "company_memberships" ADD COLUMN     "access" JSONB,
ADD COLUMN     "home_branch_id" UUID,
ADD COLUMN     "is_corporate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "user_type" "UserType";

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "personal_user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_personal_user_id_key" ON "roles"("company_id", "personal_user_id");

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_home_branch_id_fkey" FOREIGN KEY ("home_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_personal_user_id_fkey" FOREIGN KEY ("personal_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A member works at one branch, or at every branch (Corporate) — never both.
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_home_branch_or_corporate"
  CHECK (NOT ("is_corporate" AND "home_branch_id" IS NOT NULL));
