ALTER TABLE "pg-drizzle_clinic"
  ADD COLUMN "no_show_policy" text DEFAULT 'alert' NOT NULL,
  ADD CONSTRAINT "clinic_no_show_policy"
    CHECK ("no_show_policy" IN ('alert', 'cancel-after-third-reminder'));
--> statement-breakpoint
CREATE TABLE "pg-drizzle_daily_agenda_email" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "agenda_date" date NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "daily_agenda_email_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "pg-drizzle_doctor" ("clinic_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_agenda_email_doctor_date_unique"
  ON "pg-drizzle_daily_agenda_email" USING btree ("doctor_id", "agenda_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_reminder_claim_unique"
  ON "pg-drizzle_appointment_event" USING btree ("appointment_id", "type", "reason")
  WHERE "type" = 'reminder-claimed';
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_no_show_outcome_unique"
  ON "pg-drizzle_appointment_event" USING btree ("appointment_id")
  WHERE "type" IN ('no-show-alerted', 'no-show-auto-cancelled');
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_reminder_callback_unique"
  ON "pg-drizzle_appointment_event" USING btree ("appointment_id", "reason", "recipient_contact_id")
  WHERE "type" IN ('reminder-delivered', 'reminder-delivery-failed');
--> statement-breakpoint
ALTER TABLE "pg-drizzle_daily_agenda_email" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_daily_agenda_email" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "scheduler_clinic_read" ON "pg-drizzle_clinic" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "clinic_owner_updates_no_show_policy" ON "pg-drizzle_clinic" FOR UPDATE
  USING (
    "id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
--> statement-breakpoint
GRANT UPDATE ON TABLE "pg-drizzle_clinic" TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "appointment_scheduler_access" ON "pg-drizzle_appointment" FOR ALL
  USING (current_setting('app.appointment_scheduler', true) = 'true')
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "appointment_event_scheduler_append" ON "pg-drizzle_appointment_event" FOR INSERT
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "appointment_event_scheduler_read" ON "pg-drizzle_appointment_event" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "appointment_scheduler_clinic_user_read" ON "pg-drizzle_clinic_user" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "simulated_whatsapp_message_scheduler_read" ON "pg-drizzle_simulated_whatsapp_message" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "patient_scheduler_read" ON "pg-drizzle_patient" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "doctor_scheduler_read" ON "pg-drizzle_doctor" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "contact_patient_link_scheduler_read" ON "pg-drizzle_contact_patient_link" FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
GRANT SELECT ON TABLE "user" TO panacea_clinical_access;
CREATE POLICY "temporary_reservation_scheduler_delete" ON "pg-drizzle_temporary_reservation" FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
CREATE POLICY "daily_agenda_email_scheduler_access" ON "pg-drizzle_daily_agenda_email" FOR ALL
  USING (current_setting('app.appointment_scheduler', true) = 'true')
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "pg-drizzle_daily_agenda_email"
TO panacea_clinical_access;
