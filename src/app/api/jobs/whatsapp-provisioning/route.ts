import { env } from "~/env";
import { runKapsoProvisioningWorker } from "~/server/application/whatsapp-provisioning";
import { runWhatsAppReadinessReconciliation } from "~/server/application/whatsapp-readiness";
import { drizzleWhatsAppProvisioningStore } from "~/server/db/whatsapp-provisioning-store";
import { drizzleWhatsAppReadinessStore } from "~/server/db/whatsapp-readiness-store";
import { drizzleWhatsAppCircuitBreakerStore } from "~/server/db/whatsapp-circuit-breaker-store";
import { createKapsoProvisioningProvider } from "~/server/whatsapp/kapso-provisioning";
import { createKapsoReadinessProvider } from "~/server/whatsapp/kapso-readiness";

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
  const readinessProvider = createKapsoReadinessProvider({
    apiKey: env.KAPSO_API_KEY,
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
  const now = new Date();
  const result = await runKapsoProvisioningWorker(
    { now },
    drizzleWhatsAppProvisioningStore,
    provider,
    {
      circuitBreaker: drizzleWhatsAppCircuitBreakerStore,
      provider: readinessProvider,
      store: drizzleWhatsAppReadinessStore,
    },
    drizzleWhatsAppCircuitBreakerStore,
  );
  const reconciliation = await runWhatsAppReadinessReconciliation(
    { now },
    {
      provider: { ...provider, ...readinessProvider },
      store: drizzleWhatsAppReadinessStore,
    },
  );
  return Response.json({ ...result, projectWebhook, reconciliation });
}
