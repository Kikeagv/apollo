import { KapsoLifecycleEventError } from "~/domain/whatsapp-kapso-provisioning";
import { receiveKapsoWebhook } from "~/server/application/whatsapp-provisioning";
import { verifyKapsoWebhookSignature } from "~/server/whatsapp/kapso-webhook-security";

export function createKapsoWebhookHandler(input: {
  secret: string | undefined;
  store: Parameters<typeof receiveKapsoWebhook>[0]["store"];
}) {
  return async function handleKapsoWebhook(request: Request) {
    const rawBody = await request.text();
    const signature = request.headers.get("x-webhook-signature");
    if (
      input.secret === undefined ||
      !verifyKapsoWebhookSignature({
        rawBody,
        secret: input.secret,
        signature,
      })
    ) {
      return new Response("Firma inválida", { status: 401 });
    }

    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
    const eventName = request.headers.get("x-webhook-event")?.trim();
    if (idempotencyKey === undefined || idempotencyKey === "") {
      return new Response("Falta X-Idempotency-Key", { status: 400 });
    }
    if (eventName === undefined || eventName === "") {
      return new Response("Falta X-Webhook-Event", { status: 400 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return new Response("JSON inválido", { status: 400 });
    }

    try {
      const result = await receiveKapsoWebhook({
        eventName,
        idempotencyKey,
        payload,
        store: input.store,
      });
      return Response.json({
        accepted: result.accepted,
        duplicate: !result.accepted,
        eventId: result.eventId,
      });
    } catch (error) {
      if (error instanceof KapsoLifecycleEventError) {
        return new Response("Evento inválido", { status: 400 });
      }
      return new Response("No se pudo registrar el evento", { status: 503 });
    }
  };
}
