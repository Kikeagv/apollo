-- APO-91: operate a per-clinic WhatsApp circuit breaker and durable metrics.
ALTER TABLE "pg-drizzle_whatsapp_inbound_reply"
  ADD COLUMN "last_provider_event_id" text;
ALTER TABLE "pg-drizzle_whatsapp_billing"
  ADD COLUMN "credit_limit_cents" integer,
  ADD COLUMN "credit_reserve_cents" integer,
  ADD COLUMN "credit_in_flight_cents" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "estimated_daily_consumption_cents" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "warning_balance_percent" integer DEFAULT 20 NOT NULL,
  ADD COLUMN "critical_balance_percent" integer DEFAULT 10 NOT NULL,
  ADD COLUMN "warning_autonomy_days" integer DEFAULT 7 NOT NULL,
  ADD COLUMN "critical_autonomy_days" integer DEFAULT 3 NOT NULL,
  ADD COLUMN "kapso_monthly_quota" integer,
  ADD COLUMN "kapso_quota_period" text,
  ADD COLUMN "kapso_quota_consumed" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "kapso_quota_reserved" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "kapso_quota_in_flight" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_billing"
  DROP CONSTRAINT "whatsapp_billing_non_negative",
  ADD CONSTRAINT "whatsapp_billing_non_negative"
    CHECK ("credit_cents" >= 0
      AND "consumed_cents" >= 0
      AND "estimated_daily_consumption_cents" >= 0
      AND "credit_in_flight_cents" >= 0
      AND "kapso_quota_consumed" >= 0
      AND "kapso_quota_reserved" >= 0
      AND "kapso_quota_in_flight" >= 0),
  ADD CONSTRAINT "whatsapp_billing_credit_limit_non_negative"
    CHECK (("credit_limit_cents" IS NULL OR "credit_limit_cents" >= 0)
      AND ("credit_reserve_cents" IS NULL OR "credit_reserve_cents" >= 0)),
  ADD CONSTRAINT "whatsapp_billing_quota_non_negative"
    CHECK ("kapso_monthly_quota" IS NULL OR "kapso_monthly_quota" >= 0),
  ADD CONSTRAINT "whatsapp_billing_threshold_percent"
    CHECK ("warning_balance_percent" BETWEEN 0 AND 100
      AND "critical_balance_percent" BETWEEN 0 AND 100
      AND "critical_balance_percent" <= "warning_balance_percent"),
  ADD CONSTRAINT "whatsapp_billing_autonomy_days_non_negative"
    CHECK ("warning_autonomy_days" >= 0
      AND "critical_autonomy_days" >= 0
      AND "critical_autonomy_days" <= "warning_autonomy_days");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_billing_reservation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "reservation_key" text NOT NULL,
  "quota_units" integer DEFAULT 1 NOT NULL,
  "credit_cents" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "outcome" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone,
  "retain_until" timestamp with time zone NOT NULL,
  CONSTRAINT "whatsapp_billing_reservation_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_billing_reservation_non_negative"
    CHECK ("quota_units" > 0 AND "credit_cents" >= 0),
  CONSTRAINT "whatsapp_billing_reservation_status"
    CHECK ("status" IN ('reserved', 'settled', 'released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_billing_reservation_clinic_key_unique"
  ON "pg-drizzle_whatsapp_billing_reservation" USING btree ("clinic_id", "reservation_key");
CREATE INDEX "whatsapp_billing_reservation_clinic_status_idx"
  ON "pg-drizzle_whatsapp_billing_reservation" USING btree ("clinic_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_circuit_breaker" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'closed' NOT NULL,
  "cause" text,
  "reason" text DEFAULT 'Circuito cerrado' NOT NULL,
  "next_action" text DEFAULT 'La Conexión opera normalmente' NOT NULL,
  "opened_at" timestamp with time zone,
  "last_transition_at" timestamp with time zone DEFAULT now() NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "failure_window_started_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "last_synthetic_test_at" timestamp with time zone,
  "last_synthetic_test_status" text,
  "last_synthetic_evidence" text,
  "last_reactivated_at" timestamp with time zone,
  "last_reactivated_by_identity_id" text,
  "revision" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_circuit_breaker_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_circuit_breaker_identity_fk"
    FOREIGN KEY ("last_reactivated_by_identity_id") REFERENCES "user" ("id") ON DELETE set null,
  CONSTRAINT "whatsapp_circuit_breaker_status"
    CHECK ("status" IN ('closed', 'open')),
  CONSTRAINT "whatsapp_circuit_breaker_cause"
    CHECK ("status" = 'closed' OR "cause" IS NOT NULL),
  CONSTRAINT "whatsapp_circuit_breaker_reason_not_blank"
    CHECK (btrim("reason") <> '' AND btrim("next_action") <> ''),
  CONSTRAINT "whatsapp_circuit_breaker_failure_count"
    CHECK ("failure_count" >= 0 AND "revision" >= 0),
  CONSTRAINT "whatsapp_circuit_breaker_synthetic_status"
    CHECK ("last_synthetic_test_status" IS NULL
      OR "last_synthetic_test_status" IN ('passed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "whatsapp_circuit_breaker_status_idx"
  ON "pg-drizzle_whatsapp_circuit_breaker" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_circuit_breaker_alert" (
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
CREATE INDEX "whatsapp_circuit_breaker_alert_status_idx"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_circuit_breaker_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "actor_identity_id" text,
  "actor_kind" text NOT NULL,
  "action" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "cause" text,
  "reason" text NOT NULL,
  "evidence" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retain_until" timestamp with time zone NOT NULL,
  CONSTRAINT "whatsapp_circuit_breaker_audit_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_circuit_breaker_audit_identity_fk"
    FOREIGN KEY ("actor_identity_id") REFERENCES "user" ("id") ON DELETE set null,
  CONSTRAINT "whatsapp_circuit_breaker_audit_actor_kind"
    CHECK ("actor_kind" IN ('superadmin', 'system', 'worker')),
  CONSTRAINT "whatsapp_circuit_breaker_audit_action"
    CHECK ("action" IN ('failure-recorded', 'opened', 'synthetic-test', 'reactivated')),
  CONSTRAINT "whatsapp_circuit_breaker_audit_status"
    CHECK ("to_status" IN ('closed', 'open')
      AND ("from_status" IS NULL OR "from_status" IN ('closed', 'open'))),
  CONSTRAINT "whatsapp_circuit_breaker_audit_reason_not_blank"
    CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE INDEX "whatsapp_circuit_breaker_audit_clinic_idx"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit" USING btree ("clinic_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_usage_metric" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "direction" text NOT NULL,
  "category" text NOT NULL,
  "operation" text NOT NULL,
  "outcome" text NOT NULL,
  "template_name" text,
  "latency_ms" integer,
  "error_code" text,
  "meta_charges_cents" integer DEFAULT 0 NOT NULL,
  "platform_charges_cents" integer DEFAULT 0 NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retain_until" timestamp with time zone NOT NULL,
  CONSTRAINT "whatsapp_usage_metric_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_usage_metric_direction"
    CHECK ("direction" IN ('inbound', 'outbound')),
  CONSTRAINT "whatsapp_usage_metric_category"
    CHECK ("category" IN ('message', 'media', 'template', 'interactive', 'reaction', 'read-receipt')),
  CONSTRAINT "whatsapp_usage_metric_outcome"
    CHECK ("outcome" IN ('accepted', 'delivered', 'failed', 'read', 'unknown')),
  CONSTRAINT "whatsapp_usage_metric_non_negative"
    CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  CONSTRAINT "whatsapp_usage_metric_charges_non_negative"
    CHECK ("meta_charges_cents" >= 0 AND "platform_charges_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_usage_metric_clinic_key_unique"
  ON "pg-drizzle_whatsapp_usage_metric" USING btree ("clinic_id", "idempotency_key");
CREATE INDEX "whatsapp_usage_metric_clinic_occurred_idx"
  ON "pg-drizzle_whatsapp_usage_metric" USING btree ("clinic_id", "occurred_at");
CREATE INDEX "whatsapp_usage_metric_template_idx"
  ON "pg-drizzle_whatsapp_usage_metric" USING btree ("clinic_id", "template_name", "occurred_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker_alert" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_billing_reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_billing_reservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_circuit_breaker_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_usage_metric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_usage_metric" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_circuit_breaker"
  TO panacea_clinical_access;
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_circuit_breaker_alert"
  TO panacea_clinical_access;
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_billing_reservation"
  TO panacea_clinical_access;
GRANT DELETE ON TABLE
  "pg-drizzle_whatsapp_billing_reservation",
  "pg-drizzle_whatsapp_circuit_breaker_audit",
  "pg-drizzle_whatsapp_usage_metric"
  TO panacea_clinical_access;
GRANT SELECT, INSERT ON TABLE "pg-drizzle_whatsapp_circuit_breaker_audit"
  TO panacea_clinical_access;
GRANT SELECT, INSERT ON TABLE "pg-drizzle_whatsapp_usage_metric"
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
CREATE POLICY "whatsapp_circuit_breaker_superadmin_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_circuit_breaker_alert_superadmin_manage"
  ON "pg-drizzle_whatsapp_circuit_breaker_alert"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
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
CREATE POLICY "whatsapp_billing_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_billing"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
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
CREATE POLICY "whatsapp_billing_reservation_outbound_worker_manage"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_billing_reservation_outbound_worker_insert"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR INSERT
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
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
CREATE POLICY "whatsapp_billing_scheduler_read"
  ON "pg-drizzle_whatsapp_billing"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "whatsapp_billing_scheduler_capacity_update"
  ON "pg-drizzle_whatsapp_billing"
  FOR UPDATE
  USING (current_setting('app.appointment_scheduler', true) = 'true')
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "whatsapp_billing_reservation_scheduler_read"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "whatsapp_billing_reservation_scheduler_update"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR UPDATE
  USING (current_setting('app.appointment_scheduler', true) = 'true')
  WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
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
CREATE POLICY "whatsapp_inbound_reply_scheduler_read"
  ON "pg-drizzle_whatsapp_inbound_reply"
  FOR SELECT
  USING (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "whatsapp_circuit_breaker_clinic_owner_read"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_circuit_breaker_provider_read"
  ON "pg-drizzle_whatsapp_circuit_breaker"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
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
CREATE POLICY "whatsapp_circuit_breaker_audit_superadmin_read"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_circuit_breaker_audit_superadmin_append"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
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
CREATE POLICY "whatsapp_usage_metric_superadmin_read"
  ON "pg-drizzle_whatsapp_usage_metric"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
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
CREATE POLICY "whatsapp_operational_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_circuit_breaker_audit"
  FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "whatsapp_metric_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_usage_metric"
  FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "whatsapp_reservation_retention_scheduler_delete"
  ON "pg-drizzle_whatsapp_billing_reservation"
  FOR DELETE
  USING (current_setting('app.appointment_scheduler', true) = 'true');
--> statement-breakpoint
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
    AND "status" IN ('provisioning', 'degraded', 'blocked')
  );
