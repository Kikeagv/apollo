CREATE TABLE "pg-drizzle_demo_request_rate_limit_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_request_rate_limit_scope_key_idx" ON "pg-drizzle_demo_request_rate_limit_attempt" USING btree ("scope","key_hash","requested_at");--> statement-breakpoint
ALTER TABLE "pg-drizzle_demo_request_rate_limit_attempt"
  ADD CONSTRAINT "demo_request_rate_limit_scope_check"
  CHECK ("scope" IN ('ip', 'email'));--> statement-breakpoint
ALTER TABLE "pg-drizzle_demo_request_rate_limit_attempt"
  ADD CONSTRAINT "demo_request_rate_limit_hash_check"
  CHECK (length("key_hash") = 64);--> statement-breakpoint
ALTER TABLE "pg-drizzle_demo_request_rate_limit_attempt"
  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pg-drizzle_demo_request_rate_limit_attempt"
  FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "demo_request_rate_limit_key_read"
  ON "pg-drizzle_demo_request_rate_limit_attempt"
  FOR SELECT
  USING (
    "scope" = current_setting('app.demo_request_rate_limit_scope', true)
    AND "key_hash" = NULLIF(current_setting('app.demo_request_rate_limit_key', true), '')
  );--> statement-breakpoint
CREATE POLICY "demo_request_rate_limit_key_insert"
  ON "pg-drizzle_demo_request_rate_limit_attempt"
  FOR INSERT
  WITH CHECK (
    "scope" = current_setting('app.demo_request_rate_limit_scope', true)
    AND "key_hash" = NULLIF(current_setting('app.demo_request_rate_limit_key', true), '')
  );--> statement-breakpoint
CREATE POLICY "demo_request_rate_limit_key_delete"
  ON "pg-drizzle_demo_request_rate_limit_attempt"
  FOR DELETE
  USING (
    (
      "scope" = current_setting('app.demo_request_rate_limit_scope', true)
      AND "key_hash" = NULLIF(current_setting('app.demo_request_rate_limit_key', true), '')
    )
    OR current_setting('app.demo_request_rate_limit_prune', true) = 'true'
  );--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE
  "pg-drizzle_demo_request_rate_limit_attempt"
TO panacea_clinical_access;
