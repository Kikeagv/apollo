DROP POLICY "clinic_membership_operating_read" ON "pg-drizzle_clinic_user";
--> statement-breakpoint
CREATE POLICY "clinic_membership_calendar_read" ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    "identity_id" = NULLIF(current_setting('app.identity_id', true), '')
    OR (
      "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      AND current_setting('app.panacea_operation', true) = 'appointments'
    )
  );
--> statement-breakpoint
DROP POLICY "doctor_operating_read" ON "pg-drizzle_doctor";
--> statement-breakpoint
CREATE POLICY "doctor_calendar_read" ON "pg-drizzle_doctor"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'appointments'
  );
--> statement-breakpoint
DROP POLICY "temporary_reservation_operating_read" ON "pg-drizzle_temporary_reservation";
--> statement-breakpoint
CREATE POLICY "temporary_reservation_capacity_read" ON "pg-drizzle_temporary_reservation"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
      OR current_setting('app.panacea_operation', true) = 'appointments'
    )
  );
--> statement-breakpoint
DROP POLICY "effective_schedule_operating_read" ON "pg-drizzle_effective_schedule";
--> statement-breakpoint
CREATE POLICY "effective_schedule_calendar_read" ON "pg-drizzle_effective_schedule"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'appointments'
  );
--> statement-breakpoint
DROP POLICY "effective_schedule_period_operating_read" ON "pg-drizzle_effective_schedule_period";
--> statement-breakpoint
CREATE POLICY "effective_schedule_period_calendar_read" ON "pg-drizzle_effective_schedule_period"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'appointments'
  );
--> statement-breakpoint
DROP POLICY "availability_block_operating_read" ON "pg-drizzle_availability_block";
--> statement-breakpoint
CREATE POLICY "availability_block_calendar_read" ON "pg-drizzle_availability_block"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'appointments'
  );
--> statement-breakpoint
DROP POLICY "service_operating_read" ON "pg-drizzle_service";
--> statement-breakpoint
CREATE POLICY "service_catalog_member_read" ON "pg-drizzle_service"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) IN ('owner', 'doctor')
  );
--> statement-breakpoint
CREATE POLICY "service_calendar_read" ON "pg-drizzle_service"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'appointments'
  );
--> statement-breakpoint
DROP POLICY "service_offer_operating_read" ON "pg-drizzle_service_offer";
--> statement-breakpoint
CREATE POLICY "service_offer_calendar_read" ON "pg-drizzle_service_offer"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'appointments'
  );
