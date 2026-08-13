ALTER TABLE "pg-drizzle_appointment_self_management_escalation" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
CREATE POLICY "appointment_self_management_escalation_operating_resolve"
  ON "pg-drizzle_appointment_self_management_escalation" FOR UPDATE
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT UPDATE ON TABLE "pg-drizzle_appointment_self_management_escalation"
TO panacea_clinical_access;
