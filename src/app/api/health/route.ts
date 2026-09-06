import { diagnoseWhatsAppRuntime } from "~/domain/whatsapp-runtime";
import { env } from "~/env";
import { createHealthResponse } from "./health-response";

export async function GET() {
  return createHealthResponse(
    diagnoseWhatsAppRuntime({
      kapsoApiKey: env.KAPSO_API_KEY,
      provider: env.WHATSAPP_DELIVERY,
      webhookSecret: env.KAPSO_WEBHOOK_SECRET,
    }),
  );
}
