import type { ConversationEscalationTrigger } from "./conversation-escalations";

export type WhatsAppHumanTakeoverInput = {
  clinicId: string;
  contactId: string;
  messageId: string;
  now: Date;
  trigger: Extract<
    ConversationEscalationTrigger,
    "business-app" | "unsupported-message"
  >;
};

export type WhatsAppHumanTakeoverRecord = {
  created: boolean;
  id: string;
  notificationSent: boolean;
  secretaryPhoneE164: string | null;
};

type WhatsAppEscalationNotificationRecord = {
  id: string;
  notificationSent?: boolean;
  secretaryPhoneE164: string | null;
};

/** Puerto mínimo para abrir un takeover sin acoplarlo al diálogo de Agenda. */
export type WhatsAppHumanTakeoverStore = {
  getConversation(input: {
    clinicId: string;
    contactId: string;
  }): Promise<{ escalationId: string | null }>;
  markConversationEscalationNotificationSent?(input: {
    clinicId: string;
    escalationId: string;
    sentAt: Date;
  }): Promise<void>;
  notifySecretaryOfConversationEscalation?(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
  openHumanTakeover(
    input: WhatsAppHumanTakeoverInput,
  ): Promise<WhatsAppHumanTakeoverRecord>;
};

/** Abre una tarea humana persistente para un evento que no debe llegar al asistente. */
export async function activateWhatsAppHumanTakeover(
  input: WhatsAppHumanTakeoverInput,
  store: WhatsAppHumanTakeoverStore,
): Promise<void> {
  const escalation = await store.openHumanTakeover(input);
  await notifySecretaryOfEscalation(
    store,
    escalation,
    input.clinicId,
    input.trigger,
  );
}

/** Consulta el estado persistido antes de que un mensaje vuelva al gate. */
export async function isWhatsAppHumanTakeoverActive(
  input: { clinicId: string; contactId: string },
  store: Pick<WhatsAppHumanTakeoverStore, "getConversation">,
) {
  return (await store.getConversation(input)).escalationId !== null;
}

export async function notifySecretaryOfEscalation(
  store: Pick<
    WhatsAppHumanTakeoverStore,
    | "markConversationEscalationNotificationSent"
    | "notifySecretaryOfConversationEscalation"
  >,
  escalation: WhatsAppEscalationNotificationRecord,
  clinicId: string,
  trigger: ConversationEscalationTrigger,
) {
  if (
    escalation.notificationSent === true ||
    escalation.secretaryPhoneE164 === null ||
    store.notifySecretaryOfConversationEscalation === undefined
  )
    return;
  await store.notifySecretaryOfConversationEscalation({
    clinicId,
    escalationId: escalation.id,
    recipientPhoneE164: escalation.secretaryPhoneE164,
    trigger,
  });
  await store.markConversationEscalationNotificationSent?.({
    clinicId,
    escalationId: escalation.id,
    sentAt: new Date(),
  });
}
