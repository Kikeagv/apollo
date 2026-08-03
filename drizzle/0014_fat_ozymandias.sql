ALTER TABLE "pg-drizzle_clinic_invitation"
  RENAME COLUMN "owner_name" TO "recipient_name";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation"
  ADD COLUMN "role" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_clinic_invitation"
  TO panacea_clinical_access;
--> statement-breakpoint
DROP POLICY "clinic_membership_isolation" ON "pg-drizzle_clinic_user";
--> statement-breakpoint
CREATE POLICY "clinic_membership_read" ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    identity_id = NULLIF(current_setting('app.identity_id', true), '')
    OR (
      clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      AND (
        current_setting('app.clinic_role', true) = 'owner'
        OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
      )
    )
  );
--> statement-breakpoint
CREATE POLICY "clinic_membership_write" ON "pg-drizzle_clinic_user"
  FOR ALL
  USING (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.invitation_token_hash', true), '') IS NOT NULL
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "clinic_invitation_isolation" ON "pg-drizzle_clinic_invitation";
--> statement-breakpoint
CREATE POLICY "clinic_invitation_owner_access" ON "pg-drizzle_clinic_invitation"
  FOR ALL
  USING (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "doctor_clinic_isolation" ON "pg-drizzle_doctor";
--> statement-breakpoint
CREATE POLICY "doctor_configuration_access" ON "pg-drizzle_doctor"
  FOR ALL
  USING (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR clinic_user_id = NULLIF(current_setting('app.clinic_user_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR clinic_user_id = NULLIF(current_setting('app.clinic_user_id', true), '')::uuid
      OR NULLIF(current_setting('app.invitation_token_hash', true), '') IS NOT NULL
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "configuration_audit_clinic_isolation" ON "pg-drizzle_configuration_audit_event";
--> statement-breakpoint
CREATE POLICY "configuration_audit_configuration_access"
  ON "pg-drizzle_configuration_audit_event"
  FOR ALL
  USING (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR actor_identity_id = NULLIF(current_setting('app.identity_id', true), '')
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR actor_identity_id = NULLIF(current_setting('app.identity_id', true), '')
      OR NULLIF(current_setting('app.invitation_token_hash', true), '') IS NOT NULL
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
