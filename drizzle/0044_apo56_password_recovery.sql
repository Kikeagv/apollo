CREATE TABLE "pg-drizzle_identity_login_failure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_identity_recovery_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_login_failure" ADD CONSTRAINT "pg-drizzle_identity_login_failure_identity_id_user_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_login_failure_identity_idx" ON "pg-drizzle_identity_login_failure" USING btree ("identity_id","failed_at");--> statement-breakpoint
CREATE INDEX "identity_recovery_request_ip_idx" ON "pg-drizzle_identity_recovery_request" USING btree ("ip_hash","requested_at");--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_login_failure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_login_failure" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "identity_login_failure_identity_isolation" ON "pg-drizzle_identity_login_failure"
  USING (identity_id = NULLIF(current_setting('app.identity_id', true), ''))
  WITH CHECK (identity_id = NULLIF(current_setting('app.identity_id', true), ''));--> statement-breakpoint
CREATE POLICY "identity_audit_unscoped_password_reset" ON "pg-drizzle_identity_audit_event"
  FOR INSERT
  WITH CHECK (clinic_id IS NULL AND action = 'identity-password-reset-succeeded');--> statement-breakpoint
CREATE POLICY "identity_audit_unscoped_sessions_revoked" ON "pg-drizzle_identity_audit_event"
  FOR INSERT
  WITH CHECK (clinic_id IS NULL AND action = 'identity-sessions-revoked');--> statement-breakpoint
CREATE POLICY "identity_audit_unscoped_login_blocked" ON "pg-drizzle_identity_audit_event"
  FOR INSERT
  WITH CHECK (clinic_id IS NULL AND action = 'identity-login-blocked');
--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_recovery_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_recovery_request" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "identity_recovery_request_ip_isolation" ON "pg-drizzle_identity_recovery_request"
  USING (ip_hash = NULLIF(current_setting('app.recovery_request_ip', true), ''))
  WITH CHECK (ip_hash = NULLIF(current_setting('app.recovery_request_ip', true), ''));
