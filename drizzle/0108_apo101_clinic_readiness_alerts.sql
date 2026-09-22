-- APO-101: permitir que el Médico propietario vea las alertas de su Clínica.
CREATE POLICY "whatsapp_connection_alert_clinic_owner_read"
  ON "pg-drizzle_whatsapp_connection_alert"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
