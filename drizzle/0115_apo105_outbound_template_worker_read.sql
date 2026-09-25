-- APO-105: el outbox necesita validar plantillas aprobadas bajo RLS antes de enviar.
DROP POLICY IF EXISTS "whatsapp_critical_template_outbound_worker_read"
  ON "pg-drizzle_whatsapp_critical_template";
CREATE POLICY "whatsapp_critical_template_outbound_worker_read"
  ON "pg-drizzle_whatsapp_critical_template"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
