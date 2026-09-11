-- APO-78: preserve Business App message.sent events in the inbound queue so
-- the worker can open or maintain human takeover before delivery processing.
ALTER TABLE "pg-drizzle_whatsapp_inbound_message"
  DROP CONSTRAINT "whatsapp_inbound_message_event_name",
  ADD CONSTRAINT "whatsapp_inbound_message_event_name"
    CHECK ("event_name" IN ('whatsapp.message.received', 'whatsapp.message.sent'));
