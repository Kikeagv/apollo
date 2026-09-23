-- APO-104: las claves de deduplicación pertenecen al customer de Kapso.
-- customer_id NULL queda en un namespace legado único mediante coalesce.
DROP INDEX IF EXISTS "whatsapp_inbound_message_idempotency_unique";
CREATE UNIQUE INDEX "whatsapp_inbound_message_idempotency_unique"
  ON "pg-drizzle_whatsapp_inbound_message"
  USING btree (coalesce("customer_id", ''), "idempotency_key");

DROP INDEX IF EXISTS "whatsapp_inbound_message_message_unique";
CREATE UNIQUE INDEX "whatsapp_inbound_message_message_unique"
  ON "pg-drizzle_whatsapp_inbound_message"
  USING btree (coalesce("customer_id", ''), "phone_number_id", "message_id");
