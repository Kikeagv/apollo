ALTER TABLE "pg-drizzle_clinic"
  ADD COLUMN "whatsapp_number_e164" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_whatsapp_number_e164_unique"
  ON "pg-drizzle_clinic" USING btree ("whatsapp_number_e164")
  WHERE "whatsapp_number_e164" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_patient" ADD COLUMN "dui" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_temporary_reservation"
  ADD COLUMN "contact_id" uuid,
  ADD COLUMN "patient_id" uuid,
  ADD COLUMN "service_offer_id" uuid;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "author_contact_id" uuid;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_event"
  ALTER COLUMN "actor_clinic_user_id" DROP NOT NULL,
  ADD COLUMN "actor_contact_id" uuid;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment"
  ADD CONSTRAINT "appointment_author_contact_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "author_contact_id")
  REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_event"
  ADD CONSTRAINT "appointment_event_actor_contact_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "actor_contact_id")
  REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_temporary_reservation"
  ADD CONSTRAINT "temporary_reservation_contact_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "contact_id")
  REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "temporary_reservation_patient_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "patient_id")
  REFERENCES "pg-drizzle_patient" ("clinic_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "temporary_reservation_service_offer_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "service_offer_id")
  REFERENCES "pg-drizzle_service_offer" ("clinic_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_conversation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "state" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_conversation_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_conversation_contact_unique"
  ON "pg-drizzle_whatsapp_conversation" USING btree ("clinic_id", "contact_id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_simulated_whatsapp_message" (
  "id" text PRIMARY KEY NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "response" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "simulated_whatsapp_message_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "simulated_whatsapp_message_clinic_idx"
  ON "pg-drizzle_simulated_whatsapp_message" USING btree ("clinic_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_conversation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_simulated_whatsapp_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_simulated_whatsapp_message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clinic_whatsapp_inbound_lookup" ON "pg-drizzle_clinic" FOR SELECT
  USING (current_setting('app.whatsapp_inbound', true) = 'true' AND "whatsapp_number_e164" IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "whatsapp_conversation_clinic_isolation" ON "pg-drizzle_whatsapp_conversation"
  FOR ALL USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "simulated_whatsapp_message_clinic_isolation" ON "pg-drizzle_simulated_whatsapp_message"
  FOR ALL USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "temporary_reservation_whatsapp_insert" ON "pg-drizzle_temporary_reservation" FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "temporary_reservation_whatsapp_delete" ON "pg-drizzle_temporary_reservation" FOR DELETE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound', true) = 'true'
  );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "pg-drizzle_whatsapp_conversation",
  "pg-drizzle_simulated_whatsapp_message"
TO panacea_clinical_access;
