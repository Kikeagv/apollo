DROP POLICY IF EXISTS "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_contact_consent"
  DROP CONSTRAINT "whatsapp_contact_consent_scope";
--> statement-breakpoint
UPDATE "pg-drizzle_whatsapp_contact_consent"
SET "scope" = 'contact'
WHERE "scope" = 'channel';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_contact_consent"
  ADD CONSTRAINT "whatsapp_contact_consent_scope"
    CHECK (
      ("scope" = 'contact' AND "patient_id" IS NULL)
      OR ("scope" = 'patient' AND "patient_id" IS NOT NULL)
    );
--> statement-breakpoint
CREATE POLICY "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND "scope" = 'contact'
    AND "patient_id" IS NULL
    AND "accepted_role" = 'contact'
  );
