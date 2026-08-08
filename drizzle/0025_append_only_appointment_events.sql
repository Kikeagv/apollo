DROP POLICY IF EXISTS "appointment_event_operating_access" ON "pg-drizzle_appointment_event";
--> statement-breakpoint
CREATE POLICY "appointment_event_operating_read" ON "pg-drizzle_appointment_event"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appointment_event_append" ON "pg-drizzle_appointment_event"
  FOR INSERT
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appointment_event_superadmin_delete" ON "pg-drizzle_appointment_event"
  FOR DELETE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
GRANT DELETE ON TABLE "pg-drizzle_appointment_event" TO panacea_clinical_access;
