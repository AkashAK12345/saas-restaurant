-- Phase 11 — queue party split and advance booking.
--
-- ADDITIVE. Three new columns on queue_tokens; nothing dropped, nothing
-- rewritten. Existing rows are backfilled from the total they already carry.
--
-- WHY party_size STAYS. Every board, display, report and export already reads
-- party_size, and it is the number a host actually needs at the podium. Rather
-- than derive it on every read, it remains a stored column and a CHECK holds
-- it equal to adults + kids — so the split and the total cannot drift apart,
-- whatever writes them.

ALTER TABLE "queue_tokens"
  ADD COLUMN "adults" INTEGER,
  ADD COLUMN "kids" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "advance_booking_at" TIMESTAMPTZ(3);

-- Backfill: before this migration a party was undifferentiated, and the honest
-- reading of "4 guests" with no further information is 4 adults. Nothing is
-- invented — no row gains a child it never had.
UPDATE "queue_tokens" SET "adults" = "party_size" WHERE "adults" IS NULL;

ALTER TABLE "queue_tokens" ALTER COLUMN "adults" SET NOT NULL;

-- The invariant, enforced where it cannot be bypassed. A future writer that
-- forgets to recompute the total fails loudly instead of leaving a board
-- showing one number and a report another.
ALTER TABLE "queue_tokens"
  ADD CONSTRAINT "queue_tokens_party_size_is_adults_plus_kids"
  CHECK ("party_size" = "adults" + "kids");

-- Guests are people: never negative, and at least one of them.
ALTER TABLE "queue_tokens"
  ADD CONSTRAINT "queue_tokens_party_counts_are_sane"
  CHECK ("adults" >= 0 AND "kids" >= 0 AND "party_size" >= 1);
