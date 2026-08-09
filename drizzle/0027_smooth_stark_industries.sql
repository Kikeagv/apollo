ALTER TABLE "pg-drizzle_appointment_event" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" DROP CONSTRAINT "appointment_confirmed_status";--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD CONSTRAINT "appointment_status" CHECK ("status" IN ('confirmed', 'cancelled'));
