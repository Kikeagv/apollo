-- APO-78: allow a failed requeue to reopen the same operational alert.
CREATE POLICY "whatsapp_inbound_alert_worker_refresh"
  ON "pg-drizzle_whatsapp_inbound_alert"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND "inbound_message_id"::text = current_setting('app.whatsapp_inbound_event_id', true)
  )
  WITH CHECK (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    AND "inbound_message_id"::text = current_setting('app.whatsapp_inbound_event_id', true)
  );
