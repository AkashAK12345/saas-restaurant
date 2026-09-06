-- Global user lifecycle status.
--
-- `users.disable` has existed as a seeded permission since Phase 1 began but had
-- nothing to act on: the only way to stop a terminated employee was to
-- deactivate their CompanyMembership, which is a per-company concept and leaves
-- the account able to sign in and operate anywhere else.
--
-- UserStatus is deliberately SEPARATE from MembershipStatus:
--   UserStatus.INACTIVE       -> the account cannot authenticate at all
--   MembershipStatus.INACTIVE -> the user is not part of one specific company
--
-- The DEFAULT backfills every existing row as ACTIVE, so no current user is
-- locked out by this migration.
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "users"
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "users_status_idx" ON "users"("status");
