DROP POLICY "clinic_membership_read" ON "pg-drizzle_clinic_user";
--> statement-breakpoint
CREATE POLICY "clinic_membership_operating_read" ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    "identity_id" = NULLIF(current_setting('app.identity_id', true), '')
    OR "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "doctor_operating_read" ON "pg-drizzle_doctor"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
