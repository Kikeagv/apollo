import { z } from "zod";

export const kapsoPhoneNumberLifecycleEventNames = [
  "whatsapp.phone_number.created",
  "whatsapp.phone_number.deleted",
] as const;

export type KapsoPhoneNumberLifecycleEventName =
  (typeof kapsoPhoneNumberLifecycleEventNames)[number];

export type KapsoPhoneNumberWebhookEventName =
  (typeof kapsoPhoneNumberWebhookEventNames)[number];

export type KapsoPhoneNumberLifecycleEvent = {
  businessAccountId: string | null;
  customerId: string;
  displayPhoneE164: string | null;
  eventName: KapsoPhoneNumberLifecycleEventName;
  phoneNumberId: string;
  projectId: string;
};

export type KapsoWebhookEventPayload =
  KapsoPhoneNumberLifecycleEvent | Record<string, unknown>;

export const kapsoProvisioningStepNames = [
  "project-webhook",
  "phone-number-webhook",
] as const;

export type KapsoProvisioningStepName =
  (typeof kapsoProvisioningStepNames)[number];

export const kapsoProjectWebhookEvents = [
  "whatsapp.phone_number.created",
  "whatsapp.phone_number.deleted",
] as const;

export const kapsoPhoneNumberWebhookEvents = [
  "whatsapp.message.received",
  "whatsapp.message.sent",
  "whatsapp.message.delivered",
  "whatsapp.message.read",
  "whatsapp.message.failed",
  "whatsapp.conversation.created",
  "whatsapp.conversation.ended",
  "whatsapp.conversation.inactive",
] as const;

export const kapsoPhoneNumberWebhookEventNames = kapsoPhoneNumberWebhookEvents;

const lifecyclePayloadSchema = z.object({
  business_account_id: z.string().trim().min(1).nullish(),
  customer: z.object({ id: z.string().trim().min(1) }),
  display_phone_number: z.string().trim().min(1).nullish(),
  phone_number_id: z.string().trim().min(1),
  project: z.object({ id: z.string().trim().min(1) }),
});

export class KapsoLifecycleEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KapsoLifecycleEventError";
  }
}

export function parseKapsoPhoneNumberLifecycleEvent(
  eventName: string,
  payload: unknown,
): KapsoPhoneNumberLifecycleEvent {
  if (!isKapsoPhoneNumberLifecycleEventName(eventName)) {
    throw new KapsoLifecycleEventError(
      "Evento de ciclo de vida Kapso no soportado",
    );
  }

  const parsed = lifecyclePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new KapsoLifecycleEventError(
      "El payload de ciclo de vida Kapso es inválido",
    );
  }

  return {
    businessAccountId: parsed.data.business_account_id ?? null,
    customerId: parsed.data.customer.id,
    displayPhoneE164:
      parsed.data.display_phone_number === undefined ||
      parsed.data.display_phone_number === null
        ? null
        : normalizePhoneNumber(parsed.data.display_phone_number),
    eventName,
    phoneNumberId: parsed.data.phone_number_id,
    projectId: parsed.data.project.id,
  };
}

export function isKapsoPhoneNumberLifecycleEventName(
  value: string,
): value is KapsoPhoneNumberLifecycleEventName {
  return (kapsoPhoneNumberLifecycleEventNames as readonly string[]).includes(
    value,
  );
}

export function isKapsoPhoneNumberWebhookEventName(
  value: string,
): value is KapsoPhoneNumberWebhookEventName {
  return (kapsoPhoneNumberWebhookEventNames as readonly string[]).includes(
    value,
  );
}

function normalizePhoneNumber(value: string) {
  const normalized = value.replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
    throw new KapsoLifecycleEventError(
      "El número de WhatsApp del evento Kapso es inválido",
    );
  }
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}
