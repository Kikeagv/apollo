-- APO-108: fence resumable offboarding and scope outbox cancellation to one Clinic.
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run"
  ADD COLUMN IF NOT EXISTS "lease_token" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "pg-drizzle_whatsapp_offboarding_run"
SET
  "lease_token" = 'legacy:' || "id"::text,
  "lease_expires_at" = now() + interval '2 minutes'
WHERE "status" = 'running'
  AND ("lease_token" IS NULL OR "lease_expires_at" IS NULL);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run"
  DROP CONSTRAINT IF EXISTS "whatsapp_offboarding_run_lease";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run"
  ADD CONSTRAINT "whatsapp_offboarding_run_lease"
    CHECK (
      ("status" = 'running'
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL)
      OR ("status" <> 'running'
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL)
    );
--> statement-breakpoint

GRANT UPDATE ON TABLE "pg-drizzle_transactional_delivery"
  TO panacea_clinical_access;
--> statement-breakpoint
DROP POLICY IF EXISTS "transactional_delivery_whatsapp_offboarding_update"
  ON "pg-drizzle_transactional_delivery";
--> statement-breakpoint
CREATE POLICY "transactional_delivery_whatsapp_offboarding_update"
  ON "pg-drizzle_transactional_delivery"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_offboarding', true) = 'true'
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND "kind" IN ('appointment-message', 'appointment-reminder')
    AND (
      "status" = 'pending'
      OR ("status" = 'processing'
        AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= now()))
    )
  )
  WITH CHECK (
    current_setting('app.whatsapp_offboarding', true) = 'true'
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND "kind" IN ('appointment-message', 'appointment-reminder')
    AND "status" = 'suppressed'
    AND "last_error" = 'Conexión de WhatsApp retirada de Praxia'
  );
--> statement-breakpoint
DO $$
DECLARE
  target_table text := 'pg-drizzle_transactional_delivery';
  policy_name text;
BEGIN
  policy_name := 'subscription_active_update_' || substr(md5(target_table), 1, 8);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, target_table);
  EXECUTE format(
    'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (
      current_setting(''app.subscription_status'', true) = ''active''
      OR (
        current_setting(''app.appointment_scheduler'', true) = ''true''
        AND EXISTS (
          SELECT 1 FROM "pg-drizzle_clinic" AS scheduler_clinic
          WHERE scheduler_clinic.id = %I."clinic_id"
            AND scheduler_clinic.subscription_status = ''active''
        )
      )
      OR (
        current_setting(''app.whatsapp_outbound_worker'', true) = ''true''
        AND EXISTS (
          SELECT 1 FROM "pg-drizzle_clinic" AS outbound_clinic
          WHERE outbound_clinic.id = %I."clinic_id"
            AND outbound_clinic.subscription_status = ''active''
        )
      )
      OR (
        current_setting(''app.whatsapp_offboarding'', true) = ''true''
        AND NULLIF(current_setting(''app.superadmin_id'', true), '''') IS NOT NULL
        AND %I."clinic_id" = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid
      )
    ) WITH CHECK (
      current_setting(''app.subscription_status'', true) = ''active''
      OR (
        current_setting(''app.appointment_scheduler'', true) = ''true''
        AND EXISTS (
          SELECT 1 FROM "pg-drizzle_clinic" AS scheduler_clinic
          WHERE scheduler_clinic.id = %I."clinic_id"
            AND scheduler_clinic.subscription_status = ''active''
        )
      )
      OR (
        current_setting(''app.whatsapp_outbound_worker'', true) = ''true''
        AND EXISTS (
          SELECT 1 FROM "pg-drizzle_clinic" AS outbound_clinic
          WHERE outbound_clinic.id = %I."clinic_id"
            AND outbound_clinic.subscription_status = ''active''
        )
      )
      OR (
        current_setting(''app.whatsapp_offboarding'', true) = ''true''
        AND NULLIF(current_setting(''app.superadmin_id'', true), '''') IS NOT NULL
        AND %I."clinic_id" = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid
      )
    )',
    policy_name,
    target_table,
    target_table,
    target_table,
    target_table,
    target_table,
    target_table,
    target_table
  );
END $$;
