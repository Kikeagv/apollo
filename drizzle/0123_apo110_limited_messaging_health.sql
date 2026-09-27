ALTER TABLE "pg-drizzle_whatsapp_readiness"
  DROP CONSTRAINT "whatsapp_readiness_number_health";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_readiness"
  ADD CONSTRAINT "whatsapp_readiness_number_health"
  CHECK ("number_health" IN ('healthy', 'limited', 'degraded', 'unhealthy', 'error', 'unknown'));
