-- APO-95: el rol clínico ejecuta el alta y necesita permiso explícito para
-- insertar la Clínica y preparar el transporte sintético antes de que se fije
-- el contexto de Clínica.
GRANT INSERT ON TABLE
  "pg-drizzle_clinic",
  "pg-drizzle_whatsapp_connection"
TO panacea_clinical_access;
