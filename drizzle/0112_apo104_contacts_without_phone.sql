-- APO-104: WhatsApp can identify a Contacto by BSUID without a phone number.
ALTER TABLE "pg-drizzle_contact"
  ALTER COLUMN "phone_e164" DROP NOT NULL;
