-- Custom SQL migration file, put your code below! --
DO $$
DECLARE
  target_table text;
BEGIN
  FOR target_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'clinic_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname LIKE 'pg-drizzle_%'
      AND c.relname NOT IN (
        'pg-drizzle_transfer_payment',
        'pg-drizzle_clinic_support_session',
        'pg-drizzle_apolo_audit_event'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'support_read_' || substr(md5(target_table), 1, 8), target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (NULLIF(current_setting(''app.support_session_id'', true), '''') IS NULL)',
      'support_blocks_clinical_read_' || substr(md5(target_table), 1, 8),
      target_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
DROP POLICY "clinic_commercial_access" ON "pg-drizzle_clinic";
--> statement-breakpoint
CREATE POLICY "clinic_commercial_read" ON "pg-drizzle_clinic"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "clinic_commercial_subscription_update" ON "pg-drizzle_clinic"
  FOR UPDATE
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
