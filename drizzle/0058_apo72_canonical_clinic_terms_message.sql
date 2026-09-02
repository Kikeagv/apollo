ALTER TABLE "pg-drizzle_clinic_terms_contract"
  ADD COLUMN "acceptance_error_message" text;
--> statement-breakpoint
UPDATE "pg-drizzle_clinic_terms_contract"
SET "acceptance_error_message" =
  'Debe aceptar los Términos de uso de Praxia en su versión vigente antes de habilitar la atención por WhatsApp.'
WHERE "id" = true;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_terms_contract"
  ALTER COLUMN "acceptance_error_message" SET NOT NULL,
  ADD CONSTRAINT "clinic_terms_contract_message"
    CHECK (btrim("acceptance_error_message") <> '');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "clinic_readiness_validate_terms_acceptance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  acceptance_changed boolean;
  acceptance_error_message text;
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
     AND NOT "public"."clinic_terms_acceptance_is_current"(
       NEW."terms_accepted_at", NEW."terms_accepted_version"
     )
  THEN
    SELECT contract."acceptance_error_message"
    INTO acceptance_error_message
    FROM "public"."pg-drizzle_clinic_terms_contract" AS contract
    WHERE contract."id" = true;
    IF acceptance_error_message IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT001';
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'PT001',
      MESSAGE = acceptance_error_message;
  END IF;
  RETURN NEW;
END;
$$;
