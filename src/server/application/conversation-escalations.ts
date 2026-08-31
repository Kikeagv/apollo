import { normalizeSecretaryPhoneE164 } from "~/domain/whatsapp-operational-policies";

export type ConversationEscalationTrigger =
  | "human-request"
  | "frustration"
  | "misunderstanding"
  | "voice-transcription-disabled"
  | "voice-transcription-failed";

export type ConversationEscalation = {
  contact: { id: string; name: string };
  createdAt: Date;
  id: string;
  trigger: ConversationEscalationTrigger;
};

export type ConversationEscalationReader = {
  listConversationEscalations(input: {
    clinicId: string;
    identityId: string;
  }): Promise<ConversationEscalation[]>;
};

export type ConversationEscalationResolver = {
  resolveConversationEscalation(input: {
    clinicId: string;
    escalationId: string;
    identityId: string;
  }): Promise<boolean>;
};

export type EscalationNotificationSettings = {
  enabled: boolean;
  secretaryPhoneE164: string | null;
};

export type EscalationNotificationSettingsStore = {
  getEscalationNotificationSettings(input: {
    clinicId: string;
    identityId: string;
  }): Promise<EscalationNotificationSettings | undefined>;
  setEscalationNotificationSettings(input: {
    clinicId: string;
    enabled: boolean;
    identityId: string;
    secretaryPhoneE164: string | null;
  }): Promise<boolean>;
};

export class EscalationNotificationSettingsAccessError extends Error {
  constructor() {
    super(
      "Solo el Médico propietario puede configurar los avisos de Escalamiento",
    );
    this.name = "EscalationNotificationSettingsAccessError";
  }
}

/** Consulta en Panacea los diálogos que Asclepio ha transferido a una persona. */
export async function listConversationEscalations(
  input: { clinicId: string; identityId: string },
  store: ConversationEscalationReader,
) {
  return store.listConversationEscalations(input);
}

/** Cierra la tarea humana y devuelve el diálogo administrativo a Asclepio. */
export async function resolveConversationEscalation(
  input: { clinicId: string; escalationId: string; identityId: string },
  store: ConversationEscalationResolver,
) {
  return store.resolveConversationEscalation(input);
}

/** Consulta la configuración del aviso adicional por WhatsApp simulado. */
export async function getEscalationNotificationSettings(
  input: { clinicId: string; identityId: string },
  store: EscalationNotificationSettingsStore,
) {
  const settings = await store.getEscalationNotificationSettings(input);
  if (settings === undefined)
    throw new EscalationNotificationSettingsAccessError();
  return settings;
}

/** Activa o desactiva el aviso adicional y su destinataria secretaria. */
export async function setEscalationNotificationSettings(
  input: {
    clinicId: string;
    enabled: boolean;
    identityId: string;
    secretaryPhoneE164: string | null;
  },
  store: EscalationNotificationSettingsStore,
) {
  const secretaryPhoneE164 = normalizeSecretaryPhoneE164(
    input.secretaryPhoneE164,
  );
  if (input.enabled && secretaryPhoneE164 === null) {
    throw new Error("El aviso requiere un número E.164 de secretaria");
  }
  const normalizedInput = { ...input, secretaryPhoneE164 };
  if (!(await store.setEscalationNotificationSettings(normalizedInput))) {
    throw new EscalationNotificationSettingsAccessError();
  }
  return {
    enabled: input.enabled,
    secretaryPhoneE164,
  };
}
