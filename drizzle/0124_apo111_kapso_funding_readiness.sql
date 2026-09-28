ALTER TABLE "pg-drizzle_whatsapp_billing"
  ADD COLUMN "credit_balance_known" boolean DEFAULT false NOT NULL,
  ADD COLUMN "kapso_funding_status" text,
  ADD COLUMN "kapso_funding_reason" text,
  ADD COLUMN "kapso_paid_messages_paused" boolean;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_billing"
  ADD CONSTRAINT "whatsapp_billing_kapso_funding_status"
  CHECK (
    "kapso_funding_status" IS NULL
    OR "kapso_funding_status" IN ('funded', 'pending', 'unknown', 'not_funded', 'revoked')
  );
