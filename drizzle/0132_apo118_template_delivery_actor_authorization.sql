CREATE OR REPLACE FUNCTION public.apolo_whatsapp_template_delivery_actor_authorized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    COALESCE(
      current_setting('app.whatsapp_outbound_worker', true) = 'true',
      false
    )
    AND COALESCE(
      current_setting('app.whatsapp_template_delivery_worker', true) = 'true',
      false
    )
    AND EXISTS (
      SELECT 1
      FROM public."pg-drizzle_superadmin" AS superadmin
      WHERE superadmin."identity_id" = NULLIF(
        current_setting('app.superadmin_id', true),
        ''
      )
    );
$$;
--> statement-breakpoint
REVOKE ALL
  ON FUNCTION public.apolo_whatsapp_template_delivery_actor_authorized()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE
  ON FUNCTION public.apolo_whatsapp_template_delivery_actor_authorized()
  TO panacea_clinical_access;
