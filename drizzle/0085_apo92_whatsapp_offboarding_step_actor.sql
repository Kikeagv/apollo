-- APO-92: conserva la Identidad que ejecutó cada paso de retirada.
ALTER TABLE "pg-drizzle_whatsapp_offboarding_step_audit"
  ADD COLUMN "actor_identity_id" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_offboarding_step_audit"
  ADD CONSTRAINT "whatsapp_offboarding_step_audit_actor_fk"
    FOREIGN KEY ("actor_identity_id") REFERENCES "user" ("id")
    ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE "pg-drizzle_whatsapp_offboarding_step_audit" AS step
SET "actor_identity_id" = run."actor_identity_id"
FROM "pg-drizzle_whatsapp_offboarding_run" AS run
WHERE run."id" = step."run_id"
  AND step."actor_identity_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_offboarding_step_audit"
  ALTER COLUMN "actor_identity_id" SET NOT NULL;
