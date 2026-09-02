-- APO-73: algunas instalaciones heredadas conservan la policy obsoleta pero
-- no tienen asociado el trigger canónico de validación.
DROP TRIGGER IF EXISTS "clinic_readiness_terms_acceptance_guard"
  ON "pg-drizzle_clinic_readiness";
--> statement-breakpoint
CREATE TRIGGER "clinic_readiness_terms_acceptance_guard"
  BEFORE INSERT OR UPDATE ON "pg-drizzle_clinic_readiness"
  FOR EACH ROW
  EXECUTE FUNCTION "clinic_readiness_validate_terms_acceptance"();
