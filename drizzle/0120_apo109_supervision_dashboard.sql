-- APO-109: permite al superadmin ver las alertas de entregas sin abrir acceso
-- al contenido de la outbox, y expone solo contadores operativos del worker.
GRANT SELECT
  ON TABLE "pg-drizzle_transactional_delivery_alert"
  TO panacea_clinical_access;
--> statement-breakpoint
DROP POLICY IF EXISTS "transactional_delivery_alert_superadmin_read"
  ON "pg-drizzle_transactional_delivery_alert";
--> statement-breakpoint
CREATE POLICY "transactional_delivery_alert_superadmin_read"
  ON "pg-drizzle_transactional_delivery_alert"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.apolo_supervision_delivery_queue_status()
RETURNS TABLE(pending integer, processing integer, attention integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_identity_id text := NULLIF(current_setting('app.superadmin_id', true), '');
BEGIN
  IF actor_identity_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public."pg-drizzle_superadmin" AS superadmin
    WHERE superadmin."identity_id" = actor_identity_id
  ) THEN
    RAISE EXCEPTION 'superadmin authorization required';
  END IF;

  RETURN QUERY
    SELECT
      count(*) FILTER (
        WHERE delivery."status" = 'pending'
      )::integer,
      count(*) FILTER (
        WHERE delivery."status" = 'processing'
      )::integer,
      count(*) FILTER (
        WHERE delivery."status" IN ('failed', 'unknown')
      )::integer
    FROM public."pg-drizzle_transactional_delivery" AS delivery;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apolo_supervision_delivery_queue_status()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apolo_supervision_delivery_queue_status()
  TO panacea_clinical_access;
