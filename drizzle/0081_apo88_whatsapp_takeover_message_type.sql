-- APO-88: retain the safe provider message type on human takeovers.
ALTER TABLE "pg-drizzle_conversation_escalation"
  ADD COLUMN "source_message_type" text;
