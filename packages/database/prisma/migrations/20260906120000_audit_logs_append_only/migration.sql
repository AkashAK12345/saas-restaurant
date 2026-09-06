-- Audit logs must be genuinely append-only.
--
-- Removing HTTP routes is not sufficient: the application's Prisma client holds
-- full DML rights on the table, so `prisma.auditLog.update()` / `.delete()`
-- would otherwise succeed. These row-level triggers reject UPDATE and DELETE at
-- the database, independently of any application-layer control.
--
-- INSERT remains permitted so all existing audit writes continue to work.
--
-- NOTE ON TRUNCATE: a row-level BEFORE DELETE trigger does not fire on TRUNCATE,
-- and that is deliberate. TRUNCATE requires table-owner privileges and cannot be
-- issued through the Prisma Client query API (there is no truncate method), so it
-- is not reachable from ordinary application code. It is left available as the
-- single sanctioned maintenance/test-reset path, which avoids adding any
-- application-visible bypass (a "maintenance mode" flag checked by the trigger
-- would be exactly such a production backdoor).

CREATE OR REPLACE FUNCTION samco_audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not permitted on audit records', TG_OP
    USING ERRCODE = '0A000'; -- feature_not_supported
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_reject_update ON "audit_logs";
CREATE TRIGGER audit_logs_reject_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION samco_audit_logs_immutable();

DROP TRIGGER IF EXISTS audit_logs_reject_delete ON "audit_logs";
CREATE TRIGGER audit_logs_reject_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION samco_audit_logs_immutable();
