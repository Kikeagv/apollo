-- APO-89: persist Kapso message identity/statuses and give the outbound
-- workers their own RLS path without widening the clinic-facing surface.
ALTER TABLE "pg-drizzle_transactional_delivery"
  ADD COLUMN "provider_message_id" text,
  ADD COLUMN "provider_status" text,
  ADD COLUMN "consent_reference" text,
  ADD COLUMN "consent_decision" text,
  ADD COLUMN "consent_privacy_version" text,
  ADD COLUMN "consent_terms_version" text,
  ADD COLUMN "consent_text_reference" text,
  ADD COLUMN "consent_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery_attempt"
  ADD COLUMN "provider_message_id" text,
  ADD COLUMN "provider_event_id" text;
--> statement-breakpoint

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'pg-drizzle_transactional_delivery'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'kind|status'
  LOOP
    EXECUTE format(
      'ALTER TABLE "pg-drizzle_transactional_delivery" DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;

  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'pg-drizzle_transactional_delivery_attempt'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE "pg-drizzle_transactional_delivery_attempt" DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;

  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'pg-drizzle_whatsapp_inbound_reply'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'status'
  LOOP
    EXECUTE format(
      'ALTER TABLE "pg-drizzle_whatsapp_inbound_reply" DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_send_rate_limit_slot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "phone_number_id" text NOT NULL,
  "next_allowed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_send_rate_limit_slot_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_send_rate_limit_slot_phone_unique"
  ON "pg-drizzle_whatsapp_send_rate_limit_slot" USING btree ("phone_number_id");
ALTER TABLE "pg-drizzle_whatsapp_send_rate_limit_slot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_send_rate_limit_slot" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_send_rate_limit_slot"
  TO panacea_clinical_access;
CREATE POLICY "whatsapp_send_rate_limit_slot_provider_access"
  ON "pg-drizzle_whatsapp_send_rate_limit_slot"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery"
  ADD CONSTRAINT "transactional_delivery_kind"
    CHECK ("kind" IN ('appointment-message', 'appointment-reminder', 'daily-agenda-pdf')),
  ADD CONSTRAINT "transactional_delivery_status"
    CHECK ("status" IN ('accepted', 'delivered', 'failed', 'pending', 'processing', 'read', 'sent', 'suppressed', 'unknown'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery_attempt"
  ADD CONSTRAINT "transactional_delivery_attempt_outcome"
    CHECK ("outcome" IN ('accepted', 'callback', 'delivered', 'failed', 'read', 'sent', 'unknown'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_inbound_reply"
  ADD CONSTRAINT "whatsapp_inbound_reply_status"
    CHECK ("status" IN ('accepted', 'delivered', 'failed', 'pending', 'processing', 'read', 'sent', 'unknown'));
--> statement-breakpoint
DROP INDEX IF EXISTS "transactional_delivery_callback_unique";
CREATE UNIQUE INDEX "transactional_delivery_callback_unique"
  ON "pg-drizzle_transactional_delivery_attempt"
  USING btree ("delivery_id", "provider_event_id")
  WHERE "outcome" = 'callback' AND "provider_event_id" IS NOT NULL;
--> statement-breakpoint

DROP POLICY IF EXISTS "whatsapp_outbound_worker_clinic_read"
  ON "pg-drizzle_clinic";
CREATE POLICY "whatsapp_outbound_worker_clinic_read"
  ON "pg-drizzle_clinic"
  FOR SELECT
  USING (current_setting('app.whatsapp_outbound_worker', true) = 'true');
--> statement-breakpoint

DROP POLICY IF EXISTS "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection";
CREATE POLICY "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound', true) = 'true'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
CREATE POLICY "whatsapp_connection_outbound_worker_read"
  ON "pg-drizzle_whatsapp_connection"
  FOR SELECT
  USING (current_setting('app.whatsapp_outbound_worker', true) = 'true');
--> statement-breakpoint

DROP POLICY IF EXISTS "whatsapp_identity_subscription_active_read"
  ON "pg-drizzle_whatsapp_identity";
CREATE POLICY "whatsapp_identity_subscription_active_read"
  ON "pg-drizzle_whatsapp_identity"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.appointment_scheduler', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
CREATE POLICY "whatsapp_identity_scheduler_read"
  ON "pg-drizzle_whatsapp_identity"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint

DROP POLICY IF EXISTS "transactional_delivery_outbound_worker_access"
  ON "pg-drizzle_transactional_delivery";
CREATE POLICY "transactional_delivery_outbound_worker_access"
  ON "pg-drizzle_transactional_delivery"
  FOR ALL
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_transactional_delivery"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  )
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_transactional_delivery"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  );
CREATE POLICY "transactional_delivery_attempt_outbound_worker_access"
  ON "pg-drizzle_transactional_delivery_attempt"
  FOR ALL
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_transactional_delivery_attempt"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  )
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_transactional_delivery_attempt"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  );
CREATE POLICY "transactional_delivery_alert_outbound_worker_access"
  ON "pg-drizzle_transactional_delivery_alert"
  FOR ALL
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_transactional_delivery_alert"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  )
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_transactional_delivery_alert"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  );
--> statement-breakpoint
CREATE POLICY "appointment_event_outbound_delivery_append"
  ON "pg-drizzle_appointment_event"
  FOR INSERT
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "type" IN (
      'manual-confirmation-failed',
      'manual-confirmation-sent',
      'manual-cancellation-failed',
      'manual-cancellation-sent',
      'reminder-delivery-failed',
      'reminder-sent'
    )
  );
CREATE POLICY "appointment_event_outbound_clinic_user_read"
  ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS outbound_clinic
      WHERE outbound_clinic.id = "pg-drizzle_clinic_user"."clinic_id"
        AND outbound_clinic.subscription_status = 'active'
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "whatsapp_webhook_event_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_webhook_event";
DROP POLICY IF EXISTS "whatsapp_webhook_event_delivery_status_worker_manage"
  ON "pg-drizzle_whatsapp_webhook_event";
CREATE POLICY "whatsapp_webhook_event_delivery_status_worker_manage"
  ON "pg-drizzle_whatsapp_webhook_event"
  FOR ALL
  USING (
    current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    AND "event_name" IN (
      'whatsapp.message.sent',
      'whatsapp.message.delivered',
      'whatsapp.message.read',
      'whatsapp.message.failed'
    )
  )
  WITH CHECK (
    current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    AND "event_name" IN (
      'whatsapp.message.sent',
      'whatsapp.message.delivered',
      'whatsapp.message.read',
      'whatsapp.message.failed'
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_inbound_message_delivery_read"
  ON "pg-drizzle_whatsapp_inbound_message";
CREATE POLICY "whatsapp_inbound_message_delivery_read"
  ON "pg-drizzle_whatsapp_inbound_message"
  FOR SELECT
  USING (
    (
      current_setting('app.appointment_scheduler', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "whatsapp_critical_template_subscription_active_read"
  ON "pg-drizzle_whatsapp_critical_template";
CREATE POLICY "whatsapp_critical_template_subscription_active_read"
  ON "pg-drizzle_whatsapp_critical_template"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR (
      current_setting('app.whatsapp_outbound_worker', true) = 'true'
      AND EXISTS (
        SELECT 1
        FROM "pg-drizzle_clinic" AS outbound_clinic
        WHERE outbound_clinic.id = "pg-drizzle_whatsapp_critical_template"."clinic_id"
          AND outbound_clinic.subscription_status = 'active'
      )
    )
    OR (
      current_setting('app.appointment_scheduler', true) = 'true'
      AND EXISTS (
        SELECT 1
        FROM "pg-drizzle_clinic" AS scheduler_clinic
        WHERE scheduler_clinic.id = "pg-drizzle_whatsapp_critical_template"."clinic_id"
          AND scheduler_clinic.subscription_status = 'active'
      )
    )
  );
--> statement-breakpoint

DO $$
DECLARE
  target_table text;
  policy_guard text;
  policy_hash text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'pg-drizzle_transactional_delivery',
    'pg-drizzle_transactional_delivery_attempt',
    'pg-drizzle_transactional_delivery_alert',
    'pg-drizzle_appointment_event'
  ]
  LOOP
    policy_hash := substr(md5(target_table), 1, 8);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'subscription_active_insert_' || policy_hash,
      target_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'subscription_active_update_' || policy_hash,
      target_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'subscription_active_delete_' || policy_hash,
      target_table
    );
    policy_guard := format(
      $guard$current_setting('app.subscription_status', true) = 'active'
        OR (
          current_setting('app.appointment_scheduler', true) = 'true'
          AND EXISTS (
            SELECT 1
            FROM "pg-drizzle_clinic" AS scheduler_clinic
            WHERE scheduler_clinic.id = %I.clinic_id
              AND scheduler_clinic.subscription_status = 'active'
          )
        )
        OR (
          current_setting('app.whatsapp_outbound_worker', true) = 'true'
          AND EXISTS (
            SELECT 1
            FROM "pg-drizzle_clinic" AS outbound_clinic
            WHERE outbound_clinic.id = %I.clinic_id
              AND outbound_clinic.subscription_status = 'active'
          )
        )$guard$,
      target_table,
      target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (%s)',
      'subscription_active_insert_' || policy_hash,
      target_table,
      policy_guard
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (%s) WITH CHECK (%s)',
      'subscription_active_update_' || policy_hash,
      target_table,
      policy_guard,
      policy_guard
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (%s)',
      'subscription_active_delete_' || policy_hash,
      target_table,
      policy_guard
    );
  END LOOP;
END $$;
