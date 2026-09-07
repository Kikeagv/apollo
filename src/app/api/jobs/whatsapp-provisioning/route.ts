import { env } from "~/env";
import { runKapsoProvisioningWorker } from "~/server/application/whatsapp-provisioning";
import { drizzleWhatsAppProvisioningStore } from "~/server/db/whatsapp-provisioning-store";
import { createKapsoProvisioningProvider } from "~/server/whatsapp/kapso-provisioning";

export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }

  const provider = createKapsoProvisioningProvider({
    apiKey: env.KAPSO_API_KEY,
    secretKey: env.KAPSO_WEBHOOK_SECRET,
    webhookUrl: new URL("/api/webhooks/kapso", env.PUBLIC_SITE_URL).toString(),
  });
  // El webhook de proyecto es la fuente del primer evento created; reconcílialo
  // antes de consumir la cola para que una instalación nueva no dependa de una
  // configuración manual previa en Kapso.
  let projectWebhook: "reconciled" | "unavailable" = "reconciled";
  try {
    await drizzleWhatsAppProvisioningStore.withWebhookProvisioningLock({
      operation: () => provider.ensureProjectWebhook(),
      scope: "project",
    });
  } catch {
    // El drenaje de la cola sigue siendo útil para `deleted` y para reintentar
    // el paso de proyecto desde cada evento `created`.
    projectWebhook = "unavailable";
  }
  const result = await runKapsoProvisioningWorker(
    { now: new Date() },
    drizzleWhatsAppProvisioningStore,
    provider,
  );
  return Response.json({ ...result, projectWebhook });
}
