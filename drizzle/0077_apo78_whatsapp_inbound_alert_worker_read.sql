-- APO-78: permit the inbound worker to inspect only the alert for its event
-- while performing an idempotent refresh.
CREATE POLICY "whatsapp_inbound_alert_worker_read"
  ON "pg-drizzle_whatsapp_inbound_alert"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND "inbound_message_id"::text = current_setting('app.whatsapp_inbound_event_id', true)
  );
