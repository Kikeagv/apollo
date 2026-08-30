CREATE POLICY "clinic_membership_configuration_owner_read"
  ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
