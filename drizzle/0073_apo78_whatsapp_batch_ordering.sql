-- APO-78: preserve Kapso's batch metadata while processing available items
-- without buffering the first version of the worker.
ALTER TABLE "pg-drizzle_whatsapp_inbound_message"
  ADD COLUMN "batch_first_sequence" integer;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_inbound_message"
  ADD CONSTRAINT "whatsapp_inbound_message_batch_order_check"
    CHECK (
      ("batch_first_sequence" IS NULL AND "batch_sequence" IS NULL)
      OR (
        "batch_first_sequence" IS NOT NULL
        AND "batch_sequence" IS NOT NULL
        AND "batch_sequence" >= "batch_first_sequence"
      )
    );
