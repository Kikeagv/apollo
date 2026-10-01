-- APO-118: el worker inbound necesita leer readiness para validar el reto
-- controlado que permite completar un roundtrip con el circuito abierto.
CREATE POLICY "whatsapp_readiness_inbound_smoke_read"
  ON "pg-drizzle_whatsapp_readiness"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND current_setting('app.whatsapp_inbound_smoke_read', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
