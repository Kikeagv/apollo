ALTER TABLE "pg-drizzle_clinic_user"
  ADD CONSTRAINT "clinic_user_clinic_id_unique" UNIQUE ("clinic_id", "id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_doctor"
  ADD CONSTRAINT "doctor_clinic_user_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "clinic_user_id")
  REFERENCES "pg-drizzle_clinic_user" ("clinic_id", "id") ON DELETE cascade;
--> statement-breakpoint
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'pg-drizzle_configuration_audit_event'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format(
      'ALTER TABLE "pg-drizzle_configuration_audit_event" DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_configuration_audit_event"
  ALTER COLUMN "actor_identity_id" SET NOT NULL;
