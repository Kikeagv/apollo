ALTER TABLE "pg-drizzle_whatsapp_contact_consent"
  ALTER COLUMN "identity_id" DROP NOT NULL,
  ADD COLUMN "origin" text DEFAULT 'whatsapp_inbound' NOT NULL,
  ADD COLUMN "actor_identity_id" text,
  ADD COLUMN "source_patient_id" uuid,
  ADD CONSTRAINT "whatsapp_contact_consent_origin"
    CHECK ("origin" IN ('whatsapp_inbound', 'manual_patient_registration')),
  ADD CONSTRAINT "whatsapp_contact_consent_origin_evidence"
    CHECK (
      (
        "origin" = 'whatsapp_inbound'
        AND "identity_id" IS NOT NULL
        AND "actor_identity_id" IS NULL
        AND "source_patient_id" IS NULL
      )
      OR (
        "origin" = 'manual_patient_registration'
        AND "identity_id" IS NULL
        AND "actor_identity_id" IS NOT NULL
        AND "source_patient_id" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "whatsapp_contact_consent_actor_identity_fk"
    FOREIGN KEY ("actor_identity_id")
    REFERENCES "user" ("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "whatsapp_contact_consent_source_patient_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "source_patient_id")
    REFERENCES "pg-drizzle_patient" ("clinic_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "whatsapp_contact_consent_source_patient_idx"
  ON "pg-drizzle_whatsapp_contact_consent"
  USING btree ("clinic_id", "source_patient_id");
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent";
CREATE POLICY "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND "origin" = 'whatsapp_inbound'
    AND "identity_id" IS NOT NULL
    AND "actor_identity_id" IS NULL
    AND "source_patient_id" IS NULL
    AND "scope" = 'contact'
    AND "patient_id" IS NULL
    AND "accepted_role" = 'contact'
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_contact_consent_clinic_registration_append"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND NULLIF(current_setting('app.clinic_user_id', true), '') IS NOT NULL
    AND "actor_identity_id" = NULLIF(current_setting('app.identity_id', true), '')
    AND "origin" = 'manual_patient_registration'
    AND "identity_id" IS NULL
    AND "source_patient_id" IS NOT NULL
    AND "scope" = 'contact'
    AND "patient_id" IS NULL
    AND "accepted_role" = 'contact'
    AND "provider" = 'kapso'
    AND "status" = 'accepted'
    AND "declaration" = 'REGISTRO_MANUAL_DE_PACIENTE'
    AND "interaction_id" = 'manual-patient-registration:' || "source_patient_id"::text
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_contact_patient_link" AS registered_link
      WHERE registered_link."clinic_id" = "pg-drizzle_whatsapp_contact_consent"."clinic_id"
        AND registered_link."contact_id" = "pg-drizzle_whatsapp_contact_consent"."contact_id"
        AND registered_link."patient_id" = "pg-drizzle_whatsapp_contact_consent"."source_patient_id"
    )
  );
