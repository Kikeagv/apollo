DROP POLICY IF EXISTS "appointment_event_superadmin_delete" ON "pg-drizzle_appointment_event";
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "pg-drizzle_appointment_event"
FROM panacea_clinical_access;
