CREATE INDEX "appointment_patient_starts_at_idx" ON "pg-drizzle_appointment" USING btree ("clinic_id","patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "contact_patient_link_guardianship_idx" ON "pg-drizzle_contact_patient_link" USING btree ("clinic_id","relationship","guardianship_verification_status");--> statement-breakpoint
CREATE INDEX "contact_clinic_name_idx" ON "pg-drizzle_contact" USING btree ("clinic_id","name");--> statement-breakpoint
CREATE INDEX "patient_clinic_name_idx" ON "pg-drizzle_patient" USING btree ("clinic_id","name");--> statement-breakpoint
CREATE POLICY "doctor_patients_read" ON "pg-drizzle_doctor"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'patients'
  );--> statement-breakpoint
CREATE POLICY "service_patients_read" ON "pg-drizzle_service"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'patients'
  );--> statement-breakpoint
CREATE POLICY "service_offer_patients_read" ON "pg-drizzle_service_offer"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.panacea_operation', true) = 'patients'
  );
