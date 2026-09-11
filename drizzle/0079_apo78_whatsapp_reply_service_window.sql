-- APO-78: keep the inbound response service-window deadline in the outbox.
ALTER TABLE "pg-drizzle_whatsapp_inbound_reply"
  ADD COLUMN "service_window_expires_at" timestamp with time zone;
