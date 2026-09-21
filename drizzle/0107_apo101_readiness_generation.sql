-- APO-101: una reconciliación de Kapso solo puede persistir la generación
-- que sigue asociada a la Conexión vigente de la Clínica.
ALTER TABLE "pg-drizzle_whatsapp_readiness"
  ADD COLUMN IF NOT EXISTS "reconciliation_status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reconciliation_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "reconciliation_next_attempt_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reconciliation_lease_token" text,
  ADD COLUMN IF NOT EXISTS "reconciliation_lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reconciliation_last_attempt_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reconciliation_last_error" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_readiness"
  ADD CONSTRAINT "whatsapp_readiness_reconciliation_status"
    CHECK ("reconciliation_status" IN ('blocked', 'pending', 'processing', 'succeeded')),
  ADD CONSTRAINT "whatsapp_readiness_reconciliation_attempts_non_negative"
    CHECK ("reconciliation_attempts" >= 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_readiness_reconciliation_due_idx"
  ON "pg-drizzle_whatsapp_readiness"
  USING btree ("reconciliation_status", "reconciliation_next_attempt_at", "reconciliation_lease_expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION whatsapp_readiness_matches_current_generation(
  p_clinic_id uuid,
  p_phone_number_id text,
  p_business_account_id text,
  p_project_id text,
  p_provisioning_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."pg-drizzle_whatsapp_connection" AS current_connection
    WHERE current_connection."clinic_id" = p_clinic_id
      AND current_connection."phone_number_id" IS NOT DISTINCT FROM p_phone_number_id
      AND current_connection."business_account_id" IS NOT DISTINCT FROM p_business_account_id
      AND (current_connection."metadata" ->> 'projectId') IS NOT DISTINCT FROM p_project_id
      AND (current_connection."metadata" ->> 'provisioningEventId')
        IS NOT DISTINCT FROM p_provisioning_event_id::text
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION whatsapp_readiness_current_generation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.whatsapp_readiness_matches_current_generation(
    NEW."clinic_id",
    NEW."phone_number_id",
    NEW."business_account_id",
    NEW."project_id",
    NEW."provisioning_event_id"
  ) THEN
    RAISE EXCEPTION
      'El readiness no pertenece a la generación vigente de la Clínica';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS whatsapp_readiness_current_generation_guard
  ON "pg-drizzle_whatsapp_readiness";
--> statement-breakpoint
CREATE TRIGGER whatsapp_readiness_current_generation_guard
  BEFORE INSERT OR UPDATE ON "pg-drizzle_whatsapp_readiness"
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_readiness_current_generation_guard();
--> statement-breakpoint
CREATE POLICY "whatsapp_readiness_current_generation_insert"
  ON "pg-drizzle_whatsapp_readiness"
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    public.whatsapp_readiness_matches_current_generation(
      "clinic_id",
      "phone_number_id",
      "business_account_id",
      "project_id",
      "provisioning_event_id"
    )
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_readiness_current_generation_update"
  ON "pg-drizzle_whatsapp_readiness"
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR (
      current_setting('app.whatsapp_provisioning_worker', true) = 'true'
      AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    )
  )
  WITH CHECK (
    public.whatsapp_readiness_matches_current_generation(
      "clinic_id",
      "phone_number_id",
      "business_account_id",
      "project_id",
      "provisioning_event_id"
    )
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_readiness_reconciliation_worker_manage"
  ON "pg-drizzle_whatsapp_readiness"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND current_setting('app.whatsapp_readiness_reconciliation_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND current_setting('app.whatsapp_readiness_reconciliation_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_reconciliation_worker_update"
  ON "pg-drizzle_whatsapp_connection"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND current_setting('app.whatsapp_readiness_reconciliation_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND current_setting('app.whatsapp_readiness_reconciliation_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      "status" <> 'ready'
      OR EXISTS (
        SELECT 1
        FROM "pg-drizzle_whatsapp_readiness" AS readiness
        WHERE readiness."clinic_id" = "pg-drizzle_whatsapp_connection"."clinic_id"
          AND readiness."reconciliation_status" = 'processing'
          AND readiness."reconciliation_lease_token" = current_setting(
            'app.whatsapp_reconciliation_lease_token',
            true
          )
          AND readiness."reconciliation_lease_expires_at" > clock_timestamp()
      )
    )
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_alert_reconciliation_worker_manage"
  ON "pg-drizzle_whatsapp_connection_alert"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND current_setting('app.whatsapp_readiness_reconciliation_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_whatsapp_readiness" AS readiness
      WHERE readiness."clinic_id" = "pg-drizzle_whatsapp_connection_alert"."clinic_id"
        AND readiness."reconciliation_status" = 'processing'
        AND readiness."reconciliation_lease_token" = current_setting(
          'app.whatsapp_reconciliation_lease_token',
          true
        )
        AND readiness."reconciliation_lease_expires_at" > clock_timestamp()
    )
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND current_setting('app.whatsapp_readiness_reconciliation_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_whatsapp_readiness" AS readiness
      WHERE readiness."clinic_id" = "pg-drizzle_whatsapp_connection_alert"."clinic_id"
        AND readiness."reconciliation_status" = 'processing'
        AND readiness."reconciliation_lease_token" = current_setting(
          'app.whatsapp_reconciliation_lease_token',
          true
        )
        AND readiness."reconciliation_lease_expires_at" > clock_timestamp()
    )
  );
