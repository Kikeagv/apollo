ALTER TABLE "pg-drizzle_identity_audit_event"
  ADD COLUMN "result" text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_audit_event"
  ALTER COLUMN "result" DROP DEFAULT;
