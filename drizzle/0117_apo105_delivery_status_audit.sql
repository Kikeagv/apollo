-- APO-105: registra transiciones reconciliadas de entrega bajo RLS.
DROP POLICY IF EXISTS "appointment_event_outbound_delivery_append"
  ON "pg-drizzle_appointment_event";
CREATE POLICY "appointment_event_outbound_delivery_append"
  ON "pg-drizzle_appointment_event"
  FOR INSERT
  WITH CHECK (
    current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "type" IN (
      'appointment-cancellation-failed',
      'appointment-cancellation-sent',
      'appointment-confirmation-failed',
      'appointment-confirmation-sent',
      'appointment-delivery-status',
      'appointment-reschedule-failed',
      'appointment-reschedule-sent',
      'manual-confirmation-failed',
      'manual-confirmation-sent',
      'manual-cancellation-failed',
      'manual-cancellation-sent',
      'reminder-delivery-failed',
      'reminder-sent'
    )
  );
