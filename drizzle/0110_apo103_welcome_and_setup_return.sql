-- APO-103: persist the last verified Kapso redirect without allowing the
-- redirect to mutate a WhatsApp connection or declare it ready.
ALTER TABLE "pg-drizzle_whatsapp_setup_link"
  ADD COLUMN IF NOT EXISTS "last_return_status" text;
ALTER TABLE "pg-drizzle_whatsapp_setup_link"
  ADD COLUMN IF NOT EXISTS "last_return_error_code" text;
ALTER TABLE "pg-drizzle_whatsapp_setup_link"
  ADD COLUMN IF NOT EXISTS "last_returned_at" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_setup_link_last_return_status'
  ) THEN
    ALTER TABLE "pg-drizzle_whatsapp_setup_link"
      ADD CONSTRAINT "whatsapp_setup_link_last_return_status"
      CHECK (
        "last_return_status" IS NULL
        OR "last_return_status" IN ('success', 'cancelled', 'failed', 'pending', 'expired')
      );
  END IF;
END
$$;
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_setup_link_subscription_active_read"
  ON "pg-drizzle_whatsapp_setup_link";
CREATE POLICY "whatsapp_setup_link_subscription_active_read"
  ON "pg-drizzle_whatsapp_setup_link"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_setup_link_return', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_setup_link_subscription_active_update"
  ON "pg-drizzle_whatsapp_setup_link";
CREATE POLICY "whatsapp_setup_link_subscription_active_update"
  ON "pg-drizzle_whatsapp_setup_link"
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_setup_link_return', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  )
  WITH CHECK (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_setup_link_return', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_setup_link_return_read"
  ON "pg-drizzle_whatsapp_setup_link"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_setup_link_return', true) = 'true'
    AND "kapso_setup_link_id" = current_setting('app.whatsapp_setup_link_id', true)
  );
CREATE POLICY "whatsapp_setup_link_return_update"
  ON "pg-drizzle_whatsapp_setup_link"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_setup_link_return', true) = 'true'
    AND "kapso_setup_link_id" = current_setting('app.whatsapp_setup_link_id', true)
  )
  WITH CHECK (
    current_setting('app.whatsapp_setup_link_return', true) = 'true'
    AND "kapso_setup_link_id" = current_setting('app.whatsapp_setup_link_id', true)
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_whatsapp_setup_link_return_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.whatsapp_setup_link_return', true) = 'true'
    AND (
      (to_jsonb(NEW) - ARRAY[
        'last_return_status',
        'last_return_error_code',
        'last_returned_at',
        'updated_at'
      ]::text[])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY[
        'last_return_status',
        'last_return_error_code',
        'last_returned_at',
        'updated_at'
      ]::text[])
    )
  THEN
    RAISE EXCEPTION 'El retorno del enlace sólo puede actualizar su estado de retorno';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS whatsapp_setup_link_return_mutation_guard
  ON "pg-drizzle_whatsapp_setup_link";
CREATE TRIGGER whatsapp_setup_link_return_mutation_guard
  BEFORE UPDATE ON "pg-drizzle_whatsapp_setup_link"
  FOR EACH ROW
  EXECUTE FUNCTION guard_whatsapp_setup_link_return_mutation();
