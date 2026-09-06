-- Refresh tokens previously used a purely sliding expiry: every rotation pushed
-- expires_at forward, so a stolen-and-rotated token could keep one session alive
-- indefinitely. absolute_expires_at is fixed at login and never extended, giving
-- every session a hard ceiling regardless of how often it is refreshed.

ALTER TABLE "user_sessions" ADD COLUMN "absolute_expires_at" TIMESTAMPTZ(3);

-- Backfill existing sessions from their creation time so the column can be NOT NULL.
UPDATE "user_sessions"
SET "absolute_expires_at" = "created_at" + INTERVAL '30 days'
WHERE "absolute_expires_at" IS NULL;

ALTER TABLE "user_sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;

CREATE INDEX "user_sessions_absolute_expires_at_idx" ON "user_sessions"("absolute_expires_at");
