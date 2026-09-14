-- APO-92: persist whether the provider itself verified the external transport.
-- In-memory/local contracts must never become durable evidence for Kapso traffic.
ALTER TABLE "pg-drizzle_whatsapp_smoke_run"
  ADD COLUMN "provider_transport_verified" boolean DEFAULT false NOT NULL;
