-- APO-94: el contexto RLS del cierre también debe poder dejar el evento de
-- auditoría que acompaña cada registro de evidencia.
GRANT INSERT ON TABLE "pg-drizzle_apolo_audit_event"
  TO panacea_clinical_access;
