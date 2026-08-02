ALTER TABLE "pg-drizzle_identity_audit_event"
  ADD COLUMN "actor_kind" text NOT NULL DEFAULT 'identity';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_audit_event"
  ALTER COLUMN "actor_kind" DROP DEFAULT;
