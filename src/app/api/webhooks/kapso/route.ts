import { env } from "~/env";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import { drizzleWhatsAppProvisioningStore } from "~/server/db/whatsapp-provisioning-store";
import { createKapsoWebhookHandler } from "./handler";

export const POST = createKapsoWebhookHandler({
  secret: env.KAPSO_WEBHOOK_SECRET,
  store: {
    ...drizzleWhatsAppProvisioningStore,
    enqueueInbound: (input) =>
      drizzleWhatsAppInboundStore.enqueueInbound(input),
  },
});
