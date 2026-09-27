CREATE POLICY "identity_audit_superadmin_unscoped"
  ON "pg-drizzle_identity_audit_event"
  FOR INSERT
  WITH CHECK (
    clinic_id IS NULL
    AND actor_identity_id = NULLIF(current_setting('app.superadmin_id', true), '')
    AND action IN (
      'identity-login-failed',
      'identity-login-succeeded',
      'identity-login-blocked',
      'identity-password-reset-succeeded',
      'identity-sessions-revoked'
    )
  );
