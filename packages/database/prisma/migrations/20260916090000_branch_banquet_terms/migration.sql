-- Configurable terms and conditions for banquet bills (SRS §5.3.7).
--
-- Additive only: a nullable column, so every existing branch keeps printing
-- exactly what it printed before (no terms) until someone writes them.
--
-- The CHECK mirrors the API's 4000-character ceiling, so the limit holds for
-- any writer, not just the application.

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "banquet_terms" TEXT;

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_banquet_terms_length"
  CHECK ("banquet_terms" IS NULL OR char_length("banquet_terms") <= 4000);
