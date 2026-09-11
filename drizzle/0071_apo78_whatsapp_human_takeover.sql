-- APO-78: persist the takeover causes emitted by the Kapso inbound worker.
ALTER TABLE "pg-drizzle_conversation_escalation"
  DROP CONSTRAINT "pg-drizzle_conversation_escalation_trigger_check",
  ADD CONSTRAINT "pg-drizzle_conversation_escalation_trigger_check"
    CHECK ("trigger" IN (
      'business-app',
      'human-request',
      'frustration',
      'misunderstanding',
      'voice-transcription-disabled',
      'voice-transcription-failed',
      'guardianship-pending',
      'unsupported-message'
    ));
