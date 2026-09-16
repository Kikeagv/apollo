-- APO-94: restore the application-side terms contract when data was reset.
-- The public landing page remains the legal source; this singleton supplies the
-- version and acceptance message used by clinic readiness checks.
INSERT INTO "pg-drizzle_clinic_terms_contract" (
  "id",
  "current_version",
  "acceptance_error_message"
)
VALUES (
  true,
  '1.0',
  'Debe aceptar los Términos de uso de Praxia en su versión vigente antes de habilitar la atención por WhatsApp.'
)
ON CONFLICT ("id") DO NOTHING;
