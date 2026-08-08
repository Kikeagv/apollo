DROP POLICY "temporary_reservation_capacity_write" ON "pg-drizzle_temporary_reservation";
--> statement-breakpoint
CREATE POLICY "temporary_reservation_capacity_write" ON "pg-drizzle_temporary_reservation"
  FOR ALL
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
