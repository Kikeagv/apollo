GRANT panacea_clinical_access TO CURRENT_USER;
--> statement-breakpoint
GRANT SELECT
ON TABLE
  "pg-drizzle_clinic",
  "pg-drizzle_clinic_session",
  "pg-drizzle_clinic_user",
  "pg-drizzle_identity_audit_event",
  "pg-drizzle_patient",
  "pg-drizzle_trusted_clinic_device"
TO panacea_clinical_access;
