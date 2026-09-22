-- APO-101: repair schema and singleton drift left behind by older ledger gaps.
-- Drizzle applies only migrations newer than the latest recorded timestamp, so
-- these idempotent repairs must be available as a forward migration.
-- APO-94: restore the application-side terms contract when data was reset.
-- The public landing page remains the legal source; this singleton supplies the
-- version and acceptance message used by clinic readiness checks.
INSERT INTO "pg-drizzle_clinic_terms_contract" (
  "id",
  "current_version",
  "acceptance_error_message"
)
VALUES (
  true,
  '1.0',
  'Debe aceptar los Términos de uso de Praxia en su versión vigente antes de habilitar la atención por WhatsApp.'
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_inbound_reply"
  ADD COLUMN IF NOT EXISTS "last_provider_event_id" text;
ALTER TABLE "pg-drizzle_whatsapp_billing_reservation"
  ADD COLUMN IF NOT EXISTS "reserved_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg-drizzle_whatsapp_circuit_breaker_alert" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "cause" text NOT NULL,
  "reason" text NOT NULL,
  "next_action" text NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_circuit_breaker_alert_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_circuit_breaker_alert_status"
    CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "whatsapp_circuit_breaker_alert_reason_not_blank"
    CHECK (btrim("reason") <> '' AND btrim("next_action") <> ''),
  CONSTRAINT "whatsapp_circuit_breaker_alert_resolution"
    CHECK ("status" = 'open' OR "resolved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_circuit_breaker_alert_status_idx"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert" USING btree ("status", "updated_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker_alert" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_circuit_breaker_alert"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_whatsapp_billing_outbound_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND (
      (to_jsonb(NEW) - ARRAY[
        'credit_cents',
        'consumed_cents',
        'credit_in_flight_cents',
        'kapso_quota_consumed',
        'kapso_quota_in_flight',
        'updated_at'
      ]::text[])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY[
        'credit_cents',
        'consumed_cents',
        'credit_in_flight_cents',
        'kapso_quota_consumed',
        'kapso_quota_in_flight',
        'updated_at'
      ]::text[])
    )
  THEN
    RAISE EXCEPTION 'El worker outbound sólo puede liquidar capacidad de WhatsApp';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS whatsapp_billing_outbound_mutation_guard
  ON "pg-drizzle_whatsapp_billing";
CREATE TRIGGER whatsapp_billing_outbound_mutation_guard
  BEFORE UPDATE ON "pg-drizzle_whatsapp_billing"
  FOR EACH ROW
  EXECUTE FUNCTION guard_whatsapp_billing_outbound_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_whatsapp_connection_circuit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
  )
    AND (
      NEW."clinic_id" IS DISTINCT FROM OLD."clinic_id"
      OR NEW."connection_type" IS DISTINCT FROM OLD."connection_type"
      OR NEW."customer" IS DISTINCT FROM OLD."customer"
      OR NEW."business_account_id" IS DISTINCT FROM OLD."business_account_id"
      OR NEW."last_test_at" IS DISTINCT FROM OLD."last_test_at"
      OR NEW."phone_number_e164" IS DISTINCT FROM OLD."phone_number_e164"
      OR NEW."phone_number_id" IS DISTINCT FROM OLD."phone_number_id"
      OR NEW."provider" IS DISTINCT FROM OLD."provider"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW."status" <> 'blocked'
    )
  THEN
    RAISE EXCEPTION 'El worker de circuito sólo puede actualizar el estado operativo de WhatsApp';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS whatsapp_connection_circuit_mutation_guard
  ON "pg-drizzle_whatsapp_connection";
CREATE TRIGGER whatsapp_connection_circuit_mutation_guard
  BEFORE UPDATE ON "pg-drizzle_whatsapp_connection"
  FOR EACH ROW
  EXECUTE FUNCTION guard_whatsapp_connection_circuit_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_whatsapp_circuit_breaker_worker_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
  ) THEN
    IF OLD."status" = 'open' AND NEW."status" <> 'open' THEN
      RAISE EXCEPTION 'Sólo un superadmin puede cerrar el circuit breaker de WhatsApp';
    END IF;
    IF (
      NEW."last_reactivated_at" IS DISTINCT FROM OLD."last_reactivated_at"
      OR NEW."last_reactivated_by_identity_id" IS DISTINCT FROM OLD."last_reactivated_by_identity_id"
      OR NEW."last_synthetic_evidence" IS DISTINCT FROM OLD."last_synthetic_evidence"
      OR NEW."last_synthetic_test_at" IS DISTINCT FROM OLD."last_synthetic_test_at"
      OR NEW."last_synthetic_test_status" IS DISTINCT FROM OLD."last_synthetic_test_status"
    ) THEN
      RAISE EXCEPTION 'Sólo un superadmin puede actualizar la evidencia de reactivación de WhatsApp';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS whatsapp_circuit_breaker_worker_mutation_guard
  ON "pg-drizzle_whatsapp_circuit_breaker";
CREATE TRIGGER whatsapp_circuit_breaker_worker_mutation_guard
  BEFORE UPDATE ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR EACH ROW
  EXECUTE FUNCTION guard_whatsapp_circuit_breaker_worker_mutation();
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_alert_superadmin_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert";
CREATE POLICY "whatsapp_circuit_breaker_alert_superadmin_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_alert_worker_read"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert";
CREATE POLICY "whatsapp_circuit_breaker_alert_worker_read"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert"
  FOR SELECT
  USING (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_alert_worker_insert"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert";
CREATE POLICY "whatsapp_circuit_breaker_alert_worker_insert"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert"
  FOR INSERT
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_alert_worker_update"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert";
CREATE POLICY "whatsapp_circuit_breaker_alert_worker_update"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert"
  FOR UPDATE
  USING (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_superadmin_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker";
CREATE POLICY "whatsapp_circuit_breaker_superadmin_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
DROP POLICY IF EXISTS "whatsapp_billing_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_billing";
CREATE POLICY "whatsapp_billing_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_billing"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_billing_reservation_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_billing_reservation";
CREATE POLICY "whatsapp_billing_reservation_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_connection_circuit_worker_update"
  ON "pg-drizzle_whatsapp_connection";
CREATE POLICY "whatsapp_connection_circuit_worker_update"
  ON "pg-drizzle_whatsapp_connection"
  FOR UPDATE
  USING (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND "status" = 'blocked'
  );
DROP POLICY IF EXISTS "whatsapp_connection_provisioning_worker_update"
  ON "pg-drizzle_whatsapp_connection";
-- The worker may finish a leased provisioning generation as ready. Keep that
-- transition behind the active event lease and its clinic generation so a
-- generic worker session cannot reactivate a connection directly.
CREATE POLICY "whatsapp_connection_provisioning_worker_update"
  ON "pg-drizzle_whatsapp_connection"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      "status" IN ('provisioning', 'degraded', 'blocked', 'disconnected')
      OR (
        "status" = 'ready'
        AND EXISTS (
          SELECT 1
          FROM "pg-drizzle_whatsapp_webhook_event" AS event
          INNER JOIN "pg-drizzle_whatsapp_provisioning_step" AS step
            ON step."event_id" = event."id"
          WHERE event."id" = NULLIF(
            current_setting('app.whatsapp_provisioning_event_id', true),
            ''
          )::uuid
            AND event."lease_token" = current_setting(
              'app.whatsapp_provisioning_lease_token',
              true
            )
            AND event."status" = 'processing'
            AND event."lease_expires_at" > clock_timestamp()
            AND step."clinic_id" =
              "pg-drizzle_whatsapp_connection"."clinic_id"
            AND step."step" = 'project-webhook'
            AND step."status" = 'succeeded'
            AND step."phone_number_id" =
              "pg-drizzle_whatsapp_connection"."phone_number_id"
            AND step."project_id" =
              "pg-drizzle_whatsapp_connection"."metadata" ->> 'projectId'
            AND "pg-drizzle_whatsapp_connection"."metadata" ->>
              'provisioningEventId' = event."id"::text
            AND EXISTS (
              SELECT 1
              FROM "pg-drizzle_whatsapp_provisioning_step" AS phone_step
              WHERE phone_step."event_id" = event."id"
                AND phone_step."clinic_id" =
                  "pg-drizzle_whatsapp_connection"."clinic_id"
                AND phone_step."step" = 'phone-number-webhook'
                AND phone_step."status" = 'succeeded'
                AND phone_step."phone_number_id" =
                  "pg-drizzle_whatsapp_connection"."phone_number_id"
                AND phone_step."project_id" =
                  "pg-drizzle_whatsapp_connection"."metadata" ->> 'projectId'
            )
        )
      )
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_billing_outbound_worker_capacity_update"
  ON "pg-drizzle_whatsapp_billing";
CREATE POLICY "whatsapp_billing_outbound_worker_capacity_update"
  ON "pg-drizzle_whatsapp_billing"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_billing_reservation_outbound_worker_insert"
  ON "pg-drizzle_whatsapp_billing_reservation";
CREATE POLICY "whatsapp_billing_reservation_outbound_worker_insert"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR INSERT
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_billing_reservation_outbound_worker_update"
  ON "pg-drizzle_whatsapp_billing_reservation";
CREATE POLICY "whatsapp_billing_reservation_outbound_worker_update"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_billing_scheduler_read"
  ON "pg-drizzle_whatsapp_billing";
CREATE POLICY "whatsapp_billing_scheduler_read"
  ON "pg-drizzle_whatsapp_billing"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_billing_scheduler_capacity_update"
  ON "pg-drizzle_whatsapp_billing";
CREATE POLICY "whatsapp_billing_scheduler_capacity_update"
  ON "pg-drizzle_whatsapp_billing"
  FOR UPDATE
  USING (current_setting('app.appointment_scheduler', true) = 'true')
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_billing_reservation_scheduler_read"
  ON "pg-drizzle_whatsapp_billing_reservation";
CREATE POLICY "whatsapp_billing_reservation_scheduler_read"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_billing_reservation_scheduler_update"
  ON "pg-drizzle_whatsapp_billing_reservation";
CREATE POLICY "whatsapp_billing_reservation_scheduler_update"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR UPDATE
  USING (current_setting('app.appointment_scheduler', true) = 'true')
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_inbound_reply_scheduler_read"
  ON "pg-drizzle_whatsapp_inbound_reply";
CREATE POLICY "whatsapp_inbound_reply_scheduler_read"
  ON "pg-drizzle_whatsapp_inbound_reply"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_worker_insert"
  ON "pg-drizzle_whatsapp_circuit_breaker";
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_clinic_owner_read"
  ON "pg-drizzle_whatsapp_circuit_breaker";
CREATE POLICY "whatsapp_circuit_breaker_clinic_owner_read"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_provider_read"
  ON "pg-drizzle_whatsapp_circuit_breaker";
CREATE POLICY "whatsapp_circuit_breaker_provider_read"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_worker_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker";
CREATE POLICY "whatsapp_circuit_breaker_worker_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR SELECT
  USING (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_circuit_breaker_worker_insert"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR INSERT
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_worker_update"
  ON "pg-drizzle_whatsapp_circuit_breaker";
CREATE POLICY "whatsapp_circuit_breaker_worker_update"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR UPDATE
  USING (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_audit_superadmin_read"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit";
CREATE POLICY "whatsapp_circuit_breaker_audit_superadmin_read"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_audit_superadmin_append"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit";
CREATE POLICY "whatsapp_circuit_breaker_audit_superadmin_append"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
DROP POLICY IF EXISTS "whatsapp_circuit_breaker_audit_worker_append"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit";
CREATE POLICY "whatsapp_circuit_breaker_audit_worker_append"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR INSERT
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_usage_metric_superadmin_read"
  ON "pg-drizzle_whatsapp_usage_metric";
CREATE POLICY "whatsapp_usage_metric_superadmin_read"
  ON "pg-drizzle_whatsapp_usage_metric"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
DROP POLICY IF EXISTS "whatsapp_usage_metric_worker_append"
  ON "pg-drizzle_whatsapp_usage_metric";
CREATE POLICY "whatsapp_usage_metric_worker_append"
  ON "pg-drizzle_whatsapp_usage_metric"
  FOR INSERT
  WITH CHECK (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_usage_metric_worker_read"
  ON "pg-drizzle_whatsapp_usage_metric";
CREATE POLICY "whatsapp_usage_metric_worker_read"
  ON "pg-drizzle_whatsapp_usage_metric"
  FOR SELECT
  USING (
    (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
DROP POLICY IF EXISTS "whatsapp_operational_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit";
CREATE POLICY "whatsapp_operational_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_metric_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_usage_metric";
CREATE POLICY "whatsapp_metric_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_usage_metric"
  FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
DROP POLICY IF EXISTS "whatsapp_reservation_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_billing_reservation";
CREATE POLICY "whatsapp_reservation_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_billing_subscription_active_read"
  ON "pg-drizzle_whatsapp_billing";
CREATE POLICY "whatsapp_billing_subscription_active_read"
  ON "pg-drizzle_whatsapp_billing"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR current_setting('app.appointment_scheduler', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
