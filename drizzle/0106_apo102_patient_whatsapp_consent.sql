ALTER TABLE "pg-drizzle_whatsapp_contact_consent"
  ADD COLUMN "declaration" text;
--> statement-breakpoint
UPDATE "pg-drizzle_whatsapp_contact_consent"
SET "declaration" = CASE
  WHEN "status" = 'revoked' THEN 'No me escriban más'
  ELSE 'CONTINUAR'
END;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_contact_consent"
  ALTER COLUMN "declaration" SET NOT NULL,
  ADD CONSTRAINT "whatsapp_contact_consent_declaration"
    CHECK (btrim("declaration") <> '');
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery"
  ADD COLUMN "patient_consent_reference" text;
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent";
CREATE POLICY "whatsapp_contact_consent_worker_append"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND (
      (
        "scope" = 'channel'
        AND "patient_id" IS NULL
        AND "accepted_role" = 'contact'
      )
      OR (
        "scope" = 'patient'
        AND "patient_id" IS NOT NULL
        AND (
          (
            "accepted_role" = 'adult-patient'
            AND upper(regexp_replace(btrim("declaration"), '[[:space:]]+', ' ', 'g')) = 'DECLARO SER EL PACIENTE Y ACEPTO RECIBIR MENSAJES ADMINISTRATIVOS POR WHATSAPP'
            AND EXISTS (
              SELECT 1
              FROM "pg-drizzle_contact_patient_link" AS consent_link
              INNER JOIN "pg-drizzle_patient" AS consent_patient
                ON consent_patient."clinic_id" = consent_link."clinic_id"
                AND consent_patient."id" = consent_link."patient_id"
              WHERE consent_link."clinic_id" = "pg-drizzle_whatsapp_contact_consent"."clinic_id"
                AND consent_link."contact_id" = "pg-drizzle_whatsapp_contact_consent"."contact_id"
                AND consent_link."patient_id" = "pg-drizzle_whatsapp_contact_consent"."patient_id"
                AND consent_link."relationship" = 'contact'
                AND consent_patient."birth_date" <= CURRENT_DATE - INTERVAL '18 years'
            )
          )
          OR (
            "accepted_role" = 'tutor'
            AND upper(regexp_replace(btrim("declaration"), '[[:space:]]+', ' ', 'g')) = 'ACEPTO RECIBIR MENSAJES ADMINISTRATIVOS POR WHATSAPP EN REPRESENTACIÓN AUTORIZADA DEL PACIENTE'
            AND EXISTS (
              SELECT 1
              FROM "pg-drizzle_contact_patient_link" AS consent_link
              WHERE consent_link."clinic_id" = "pg-drizzle_whatsapp_contact_consent"."clinic_id"
                AND consent_link."contact_id" = "pg-drizzle_whatsapp_contact_consent"."contact_id"
                AND consent_link."patient_id" = "pg-drizzle_whatsapp_contact_consent"."patient_id"
                AND consent_link."relationship" = 'tutor'
                AND consent_link."guardian_dui" ~ '^[0-9]{8}-[0-9]$'
                AND upper(regexp_replace(btrim(consent_link."guardian_declaration"), '[[:space:]]+', ' ', 'g')) = 'DECLARO REPRESENTACIÓN AUTORIZADA'
                AND consent_link."guardianship_verification_status" = 'verified'
            )
          )
        )
      )
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_contact_consent_delivery_read"
  ON "pg-drizzle_whatsapp_contact_consent";
CREATE POLICY "whatsapp_contact_consent_delivery_read"
  ON "pg-drizzle_whatsapp_contact_consent"
  FOR SELECT
  USING (
    (
      current_setting('app.whatsapp_outbound_worker', true) = 'true'
      AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      AND current_setting('app.subscription_status', true) = 'active'
    )
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
