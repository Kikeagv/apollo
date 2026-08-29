ALTER TABLE "pg-drizzle_appointment_self_management_escalation" ADD COLUMN "priority" text DEFAULT 'high' NOT NULL;--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_escalation" ADD COLUMN "priority" text DEFAULT 'high' NOT NULL;--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery_alert" ADD COLUMN "priority" text DEFAULT 'high' NOT NULL;