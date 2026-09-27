ALTER TABLE "pg-drizzle_whatsapp_connection"
  DROP CONSTRAINT IF EXISTS "whatsapp_connection_provider_type";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection"
  DROP CONSTRAINT IF EXISTS "whatsapp_connection_type";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD CONSTRAINT "whatsapp_connection_type"
    CHECK ("connection_type" IN ('simulated', 'coexistence', 'dedicated'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD CONSTRAINT "whatsapp_connection_provider_type"
    CHECK (
      ("provider" = 'simulated' AND "connection_type" = 'simulated')
      OR ("provider" = 'kapso' AND "connection_type" IN ('coexistence', 'dedicated'))
    );
