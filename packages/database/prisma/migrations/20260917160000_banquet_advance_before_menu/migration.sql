-- An advance may be taken before a menu is chosen. A booking with no package
-- has no price yet, so money recorded against it cannot be compared with its
-- total; the "paid never exceeds the total" rule applies once a package is set.
ALTER TABLE "banquet_bookings" DROP CONSTRAINT "banquet_bookings_paid_within_total";

ALTER TABLE "banquet_bookings"
  ADD CONSTRAINT "banquet_bookings_paid_within_total"
    CHECK ("paid_minor" >= 0 AND ("paid_minor" <= "total_amount_minor" OR "package_id" IS NULL));
