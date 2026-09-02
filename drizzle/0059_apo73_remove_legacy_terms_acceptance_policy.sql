-- APO-73: la versión vigente vive en clinic_terms_contract; la policy
-- heredada fijaba la aceptación a la versión inicial y bloqueaba la
-- reaceptación de contratos nuevos.
DROP POLICY IF EXISTS "clinic_readiness_terms_acceptance_guard"
  ON "pg-drizzle_clinic_readiness";
