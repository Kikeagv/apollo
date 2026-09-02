ALTER TABLE "pg-drizzle_clinic_readiness"
  ADD CONSTRAINT "clinic_readiness_terms_acceptance_complete"
  CHECK (
    num_nonnulls("terms_accepted_at", "terms_accepted_version") IN (0, 2)
  );
--> statement-breakpoint
CREATE FUNCTION "clinic_terms_acceptance_is_current"(
  "accepted_at" timestamp with time zone,
  "accepted_version" text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT $1 IS NOT NULL
    AND $2 = NULLIF(current_setting('app.clinic_terms_version', true), '');
$$;
--> statement-breakpoint
CREATE FUNCTION "clinic_readiness_validate_terms_acceptance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  acceptance_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    acceptance_changed := true;
  ELSE
    acceptance_changed := OLD."asclepio_enabled" IS NOT TRUE
       OR NEW."terms_accepted_at" IS DISTINCT FROM OLD."terms_accepted_at"
       OR NEW."terms_accepted_by_identity_id" IS DISTINCT FROM OLD."terms_accepted_by_identity_id"
       OR NEW."terms_accepted_version" IS DISTINCT FROM OLD."terms_accepted_version";
  END IF;
  IF NEW."asclepio_enabled"
     AND acceptance_changed
     AND NOT "clinic_terms_acceptance_is_current"(
       NEW."terms_accepted_at", NEW."terms_accepted_version"
     )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'Debe aceptar los Términos de uso de Praxia en su versión vigente antes de habilitar la atención por WhatsApp.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "clinic_readiness_terms_acceptance_guard"
  BEFORE INSERT OR UPDATE ON "pg-drizzle_clinic_readiness"
  FOR EACH ROW
  EXECUTE FUNCTION "clinic_readiness_validate_terms_acceptance"();
--> statement-breakpoint
DROP POLICY "clinic_readiness_owner_insert"
  ON "pg-drizzle_clinic_readiness";
--> statement-breakpoint
CREATE POLICY "clinic_readiness_owner_insert"
  ON "pg-drizzle_clinic_readiness"
  FOR INSERT
  TO panacea_clinical_access
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR current_setting('app.readiness_recalculation', true) = 'true'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
    AND (
      NOT "asclepio_enabled"
      OR "clinic_terms_acceptance_is_current"(
        "terms_accepted_at", "terms_accepted_version"
      )
    )
  );
