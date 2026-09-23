-- APO-104: el endpoint sólo puede confirmar el evento cuya clave o identidad
-- de mensaje está procesando; el rol de ingreso no puede leer otra Clínica.
DROP POLICY IF EXISTS "whatsapp_inbound_message_ingress_ack"
  ON "pg-drizzle_whatsapp_inbound_message";
CREATE POLICY "whatsapp_inbound_message_ingress_ack"
  ON "pg-drizzle_whatsapp_inbound_message"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_webhook_ingress', true) = 'true'
    AND (
      "idempotency_key" = NULLIF(
        current_setting('app.whatsapp_webhook_idempotency_key', true),
        ''
      )
      AND "phone_number_id" = NULLIF(
        current_setting('app.whatsapp_webhook_phone_number_id', true),
        ''
      )
      AND coalesce("customer_id", '') = coalesce(
        NULLIF(current_setting('app.whatsapp_webhook_customer', true), ''),
        ''
      )
      OR (
        "phone_number_id" = NULLIF(
          current_setting('app.whatsapp_webhook_phone_number_id', true),
          ''
        )
        AND "message_id" = NULLIF(
          current_setting('app.whatsapp_webhook_message_id', true),
          ''
        )
        AND coalesce("customer_id", '') = coalesce(
          NULLIF(current_setting('app.whatsapp_webhook_customer', true), ''),
          ''
        )
      )
    )
  );
