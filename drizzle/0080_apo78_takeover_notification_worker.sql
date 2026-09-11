-- APO-78: let the outbound worker confirm a secretary notification after Kapso acceptance.
CREATE POLICY "conversation_escalation_outbound_worker_notification"
  ON "pg-drizzle_conversation_escalation" FOR UPDATE
  USING (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
