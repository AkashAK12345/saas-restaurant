-- Deleting a booking removes its payment history with it.
--
-- The append-only rule stays exactly as strict for ordinary work: an UPDATE is
-- never permitted, and a DELETE is refused unless the transaction has declared
-- itself a booking purge by setting samco.purging_booking. Only the delete path
-- in BanquetBookingsService sets it, with SET LOCAL, so the permission ends
-- with that transaction and cannot leak into any other statement. The booking
-- and its payments are snapshotted into the audit log before they go.

CREATE OR REPLACE FUNCTION samco_banquet_payments_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('samco.purging_booking', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'banquet_payments is append-only: % is not permitted on payment history', TG_OP
    USING ERRCODE = '0A000'; -- feature_not_supported
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION samco_banquet_adjustments_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('samco.purging_booking', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'banquet_booking_adjustments is append-only: % is not permitted; record a reversing line instead', TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION samco_banquet_payment_verifications_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('samco.purging_booking', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'banquet_payment_verifications is append-only: % is not permitted', TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;
