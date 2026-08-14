ALTER TABLE "pg-drizzle_clinic" ADD COLUMN "voice_transcription_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pg-drizzle_simulated_whatsapp_message"
  ADD COLUMN "origin" text DEFAULT 'text' NOT NULL
  CHECK ("origin" IN ('text', 'voice'));--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_escalation"
  DROP CONSTRAINT "pg-drizzle_conversation_escalation_trigger_check",
  ADD CONSTRAINT "pg-drizzle_conversation_escalation_trigger_check"
    CHECK ("trigger" IN (
      'human-request',
      'frustration',
      'misunderstanding',
      'voice-transcription-disabled',
      'voice-transcription-failed'
    ));
