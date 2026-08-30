CREATE POLICY "service_catalog_owner_update"
  ON "pg-drizzle_service"
  FOR UPDATE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );

CREATE POLICY "service_offer_active_count_read"
  ON "pg-drizzle_service_offer"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND "active" = true
    AND current_setting('app.service_offer_active_count', true) = 'true'
    AND (
      current_setting('app.clinic_role', true) IN ('owner', 'doctor')
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
