-- Custom SQL migration file, put your code below! --
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'apolo_commercial_access'
  ) THEN
    CREATE ROLE apolo_commercial_access NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT apolo_commercial_access TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO apolo_commercial_access;
GRANT SELECT ON TABLE "pg-drizzle_superadmin", "pg-drizzle_clinic"
TO apolo_commercial_access;
GRANT UPDATE ("subscription_status") ON TABLE "pg-drizzle_clinic"
TO apolo_commercial_access;
--> statement-breakpoint
DROP POLICY "clinic_commercial_subscription_update" ON "pg-drizzle_clinic";
--> statement-breakpoint
CREATE POLICY "clinic_commercial_subscription_update" ON "pg-drizzle_clinic"
  FOR UPDATE
  USING (
    current_user = 'apolo_commercial_access'
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  )
  WITH CHECK (
    current_user = 'apolo_commercial_access'
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
