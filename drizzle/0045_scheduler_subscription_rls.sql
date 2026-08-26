DO $$
DECLARE
  target_table text;
  policy_guard text;
  identity_audit_null_guard text;
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
    policy_guard := format(
      'current_setting(''app.subscription_status'', true) = ''active''
       OR (
         current_setting(''app.appointment_scheduler'', true) = ''true''
         AND EXISTS (
           SELECT 1
           FROM "pg-drizzle_clinic" AS scheduler_clinic
           WHERE scheduler_clinic.id = %I."clinic_id"
             AND scheduler_clinic.subscription_status = ''active''
         )
       )',
      target_table
    );

    identity_audit_null_guard := CASE
      WHEN target_table = 'pg-drizzle_identity_audit_event'
        THEN ' OR "clinic_id" IS NULL'
      ELSE ''
    END;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'subscription_active_insert_' || substr(md5(target_table), 1, 8),
      target_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'subscription_active_update_' || substr(md5(target_table), 1, 8),
      target_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'subscription_active_delete_' || substr(md5(target_table), 1, 8),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT
       WITH CHECK ((%s)%s)',
      'subscription_active_insert_' || substr(md5(target_table), 1, 8),
      target_table,
      policy_guard,
      identity_audit_null_guard
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE
       USING (%s) WITH CHECK (%s)',
      'subscription_active_update_' || substr(md5(target_table), 1, 8),
      target_table,
      policy_guard,
      policy_guard
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE
       USING (%s)',
      'subscription_active_delete_' || substr(md5(target_table), 1, 8),
      target_table,
      policy_guard
    );
  END LOOP;
END $$;
