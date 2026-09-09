ALTER TABLE "pg-drizzle_contact_patient_link"
  ADD COLUMN "guardian_declaration" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_patient"
  ADD COLUMN "registration_message_id" text;
CREATE UNIQUE INDEX "patient_clinic_registration_message_unique"
  ON "pg-drizzle_patient"
  USING btree ("clinic_id", "registration_message_id")
  WHERE "registration_message_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_escalation"
  ADD COLUMN "source_message_id" text,
  ADD COLUMN "notification_sent_at" timestamp with time zone;
CREATE UNIQUE INDEX "conversation_escalation_source_message_unique"
  ON "pg-drizzle_conversation_escalation"
  USING btree ("clinic_id", "source_message_id")
  WHERE "source_message_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_event"
  ADD COLUMN "source_message_id" text;
CREATE UNIQUE INDEX "conversation_event_source_message_unique"
  ON "pg-drizzle_conversation_event"
  USING btree ("clinic_id", "source_message_id")
  WHERE "source_message_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_inbound_message"
  ADD COLUMN "interactive_action" text,
  ADD CONSTRAINT "whatsapp_inbound_message_interactive_action"
    CHECK ("interactive_action" IS NULL OR "interactive_action" = 'continue');
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_identity_clinic_contact_id_unique"
  ON "pg-drizzle_whatsapp_identity"
  USING btree ("clinic_id", "contact_id", "id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_contact_consent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "identity_id" uuid NOT NULL,
  "patient_id" uuid,
  "phone_e164" text,
  "scope" text NOT NULL,
  "accepted_role" text NOT NULL,
  "privacy_version" text NOT NULL,
  "terms_version" text NOT NULL,
  "text_reference" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "provider" text NOT NULL,
  "interaction_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_contact_consent_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE restrict,
  CONSTRAINT "whatsapp_contact_consent_identity_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id", "identity_id")
    REFERENCES "pg-drizzle_whatsapp_identity" ("clinic_id", "contact_id", "id") ON DELETE restrict,
  CONSTRAINT "whatsapp_contact_consent_patient_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "patient_id")
    REFERENCES "pg-drizzle_patient" ("clinic_id", "id") ON DELETE restrict,
  CONSTRAINT "whatsapp_contact_consent_scope"
    CHECK (
      ("scope" = 'channel' AND "patient_id" IS NULL)
      OR ("scope" = 'patient' AND "patient_id" IS NOT NULL)
    ),
  CONSTRAINT "whatsapp_contact_consent_role"
    CHECK ("accepted_role" IN ('adult-patient', 'contact', 'tutor')),
  CONSTRAINT "whatsapp_contact_consent_provider"
    CHECK ("provider" = 'kapso'),
  CONSTRAINT "whatsapp_contact_consent_reference"
    CHECK (btrim("text_reference") <> ''),
  CONSTRAINT "whatsapp_contact_consent_interaction"
    CHECK (btrim("interaction_id") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_contact_consent_interaction_unique"
  ON "pg-drizzle_whatsapp_contact_consent"
  USING btree ("clinic_id", "provider", "interaction_id");
CREATE UNIQUE INDEX "whatsapp_contact_consent_channel_version_unique"
  ON "pg-drizzle_whatsapp_contact_consent"
  USING btree ("clinic_id", "contact_id", "privacy_version", "terms_version", "text_reference")
  WHERE "scope" = 'channel';
CREATE INDEX "whatsapp_contact_consent_current_idx"
  ON "pg-drizzle_whatsapp_contact_consent"
  USING btree ("clinic_id", "contact_id", "scope", "accepted_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_contact_consent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_contact_consent" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "pg-drizzle_whatsapp_contact_consent"
  TO panacea_clinical_access;
REVOKE UPDATE, DELETE ON TABLE "pg-drizzle_whatsapp_contact_consent"
  FROM panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound_worker', true) = 'true'
  );
CREATE POLICY "whatsapp_contact_consent_worker_read"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound_worker', true) = 'true'
  );
CREATE POLICY "whatsapp_contact_consent_clinic_owner_read"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_contact_consent_superadmin_read"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_contact_consent_delivery_read"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    OR (
      current_setting('app.appointment_scheduler', true) = 'true'
      AND EXISTS (
        SELECT 1
        FROM "pg-drizzle_clinic" AS scheduler_clinic
        WHERE scheduler_clinic.id = "pg-drizzle_whatsapp_contact_consent"."clinic_id"
          AND scheduler_clinic.subscription_status = 'active'
      )
    )
  );
CREATE POLICY "whatsapp_contact_consent_subscription_active_read"
  ON "pg-drizzle_whatsapp_contact_consent"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
    OR (
      current_setting('app.appointment_scheduler', true) = 'true'
      AND EXISTS (
        SELECT 1
        FROM "pg-drizzle_clinic" AS scheduler_clinic
        WHERE scheduler_clinic.id = "pg-drizzle_whatsapp_contact_consent"."clinic_id"
          AND scheduler_clinic.subscription_status = 'active'
      )
    )
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_escalation"
  DROP CONSTRAINT "pg-drizzle_conversation_escalation_trigger_check",
  ADD CONSTRAINT "pg-drizzle_conversation_escalation_trigger_check"
    CHECK ("trigger" IN (
      'human-request',
      'frustration',
      'misunderstanding',
      'voice-transcription-disabled',
      'voice-transcription-failed',
      'guardianship-pending'
    ));
