DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'panacea_clinical_access'
  ) THEN
    CREATE ROLE panacea_clinical_access NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO panacea_clinical_access;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "pg-drizzle_patient", "pg-drizzle_identity_audit_event"
TO panacea_clinical_access;
