-- Signed-in devices: enough about each login for its owner to recognise it
-- and sign it out remotely. Additive; existing sessions simply show "unknown
-- device" until they are next used.

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "last_used_at" TIMESTAMPTZ(3),
ADD COLUMN     "user_agent" TEXT;

-- Bounded so a hostile User-Agent header cannot bloat the table.
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_user_agent_length" CHECK ("user_agent" IS NULL OR char_length("user_agent") <= 300),
  ADD CONSTRAINT "user_sessions_ip_address_length" CHECK ("ip_address" IS NULL OR char_length("ip_address") <= 64);
