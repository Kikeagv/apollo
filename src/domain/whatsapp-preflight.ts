export const whatsappBusinessAppStatuses = [
  "active",
  "messenger-only",
  "not-installed",
  "not-willing",
] as const;

export type WhatsAppBusinessAppStatus =
  (typeof whatsappBusinessAppStatuses)[number];

export const whatsappOnboardingModes = [
  "coexistence",
  "dedicated",
  "later",
  "not-integrated",
] as const;
export type WhatsAppOnboardingMode = (typeof whatsappOnboardingModes)[number];

export const metaAuthorityStatuses = ["confirmed", "not-confirmed"] as const;
export type MetaAuthorityStatus = (typeof metaAuthorityStatuses)[number];

export const whatsappPreflightStatuses = [
  "not-run",
  "passed",
  "blocked",
  "unavailable",
] as const;
export type WhatsAppPreflightStatus =
  (typeof whatsappPreflightStatuses)[number];

export const phoneAssociations = [
  "not-checked",
  "available",
  "same-customer",
  "other-customer",
  "ambiguous",
  "same-customer-other-number",
] as const;
export type PhoneAssociation = (typeof phoneAssociations)[number];

export const phoneConnectionTypes = [
  "unknown",
  "coexistence",
  "dedicated",
] as const;
export type PhoneConnectionType = (typeof phoneConnectionTypes)[number];

export type KapsoWhatsAppPreflightInput = {
  clinicName: string;
  metaAuthority: MetaAuthorityStatus;
  numberAssociation: PhoneAssociation;
  numberConnectionType: PhoneConnectionType;
  numberOwnedByClinic: boolean;
  ownerConfirmed: boolean;
  ownerName: string;
  phoneNumberE164: string;
  qrDeviceAvailable: boolean;
  whatsappBusinessApp: WhatsAppBusinessAppStatus;
};

/** Valores no secretos que se pueden conservar para explicar el resultado. */
export type WhatsAppPreflightChecks = Omit<
  KapsoWhatsAppPreflightInput,
  "clinicName" | "ownerName"
>;

export type WhatsAppPreflightBlockerCode =
  | "clinic-data-incomplete"
  | "meta-authority-required"
  | "messenger-not-supported"
  | "number-associated"
  | "number-association-ambiguous"
  | "number-connection-type-not-supported"
  | "customer-number-already-configured"
  | "phone-number-invalid"
  | "phone-number-not-owned"
  | "qr-device-required"
  | "whatsapp-business-app-required"
  | "whatsapp-business-app-required-for-coexistence"
  | "owner-not-confirmed";

export type WhatsAppPreflightBlocker = {
  code: WhatsAppPreflightBlockerCode;
  message: string;
  nextAction: string;
};

export type WhatsAppPreflightEvaluation = {
  blockers: WhatsAppPreflightBlocker[];
  nextAction: string;
  status: Extract<WhatsAppPreflightStatus, "blocked" | "passed">;
};

const e164Pattern = /^\+[1-9][0-9]{1,14}$/;

const actions = {
  clinicData: "Completa los datos de la Clínica y del Médico propietario.",
  metaAuthority:
    "Invita al responsable con acceso al Business Portfolio/WABA para completar la autorización.",
  messenger:
    "Migra voluntariamente el número a WhatsApp Business App o aporta otra línea.",
  numberAssociated:
    "Resuelve la asociación del número con el otro customer; Praxia no desconecta terceros.",
  numberAssociationAmbiguous:
    "Confirma en Kapso una sola configuración productiva para el número antes de continuar.",
  customerNumberAlreadyConfigured:
    "Usa el número de WhatsApp ya configurado para esta Clínica.",
  numberConnectionType:
    "Mantén el número existente en modo coexistence antes de continuar.",
  numberNotOwned: "Registra un número propio de la Clínica antes de continuar.",
  phoneNumber: "Registra un número propio válido en formato internacional.",
  qrDevice:
    "Ten a mano un dispositivo capaz de mostrar y completar el QR de coexistence.",
  whatsappBusinessApp:
    "Instala y activa WhatsApp Business App con el número propio de la Clínica.",
  coexistence:
    "Mantén WhatsApp Business App activa: el modo coexistence de esta versión no ofrece una ruta dedicada.",
  owner: "Confirma el Médico propietario y su autorización operativa.",
} as const;

/** Evalúa las condiciones que Praxia puede conocer antes de generar un enlace. */
export function evaluateKapsoWhatsAppPreflight(
  input: KapsoWhatsAppPreflightInput,
): WhatsAppPreflightEvaluation {
  const blockers: WhatsAppPreflightBlocker[] = [];

  if (input.clinicName.trim() === "" || input.ownerName.trim() === "") {
    blockers.push({
      code: "clinic-data-incomplete",
      message: "Falta el nombre de la Clínica o del Médico propietario.",
      nextAction: actions.clinicData,
    });
  }
  if (!input.ownerConfirmed) {
    blockers.push({
      code: "owner-not-confirmed",
      message:
        "El Médico propietario todavía no está confirmado para este flujo.",
      nextAction: actions.owner,
    });
  }
  if (!e164Pattern.test(input.phoneNumberE164)) {
    blockers.push({
      code: "phone-number-invalid",
      message: "El número no tiene un formato internacional E.164 válido.",
      nextAction: actions.phoneNumber,
    });
  }
  if (!input.numberOwnedByClinic) {
    blockers.push({
      code: "phone-number-not-owned",
      message: "El número no fue confirmado como propio de la Clínica.",
      nextAction: actions.numberNotOwned,
    });
  }

  if (input.whatsappBusinessApp === "not-installed") {
    blockers.push({
      code: "whatsapp-business-app-required",
      message: "El número todavía no está activo en WhatsApp Business App.",
      nextAction: actions.whatsappBusinessApp,
    });
  }
  if (input.whatsappBusinessApp === "messenger-only") {
    blockers.push({
      code: "messenger-not-supported",
      message:
        "Un número que solo usa WhatsApp Messenger personal no es elegible para coexistence.",
      nextAction: actions.messenger,
    });
  }
  if (input.whatsappBusinessApp === "not-willing") {
    blockers.push({
      code: "whatsapp-business-app-required-for-coexistence",
      message:
        "El onboarding adoptado requiere mantener WhatsApp Business App para coexistence.",
      nextAction: actions.coexistence,
    });
  }
  if (input.metaAuthority === "not-confirmed") {
    blockers.push({
      code: "meta-authority-required",
      message:
        "No se confirmó autoridad sobre el Business Portfolio/WABA de la Clínica.",
      nextAction: actions.metaAuthority,
    });
  }
  if (!input.qrDeviceAvailable) {
    blockers.push({
      code: "qr-device-required",
      message:
        "No hay un dispositivo disponible para completar el QR de coexistence.",
      nextAction: actions.qrDevice,
    });
  }
  if (input.numberAssociation === "other-customer") {
    blockers.push({
      code: "number-associated",
      message: "Kapso ya asocia el número con otro customer.",
      nextAction: actions.numberAssociated,
    });
  }
  if (input.numberAssociation === "ambiguous") {
    blockers.push({
      code: "number-association-ambiguous",
      message:
        "Kapso devolvió más de una asociación para el número de la Clínica.",
      nextAction: actions.numberAssociationAmbiguous,
    });
  }
  if (input.numberAssociation === "same-customer-other-number") {
    blockers.push({
      code: "customer-number-already-configured",
      message:
        "La Clínica ya tiene otro número de WhatsApp asociado a su customer de Kapso.",
      nextAction: actions.customerNumberAlreadyConfigured,
    });
  }
  if (
    input.numberAssociation === "same-customer" &&
    input.numberConnectionType !== "coexistence"
  ) {
    blockers.push({
      code: "number-connection-type-not-supported",
      message:
        "El número ya asociado no está confirmado como una conexión coexistence.",
      nextAction: actions.numberConnectionType,
    });
  }

  return blockers.length === 0
    ? {
        blockers: [],
        nextAction: "Generar el Enlace de configuración de WhatsApp",
        status: "passed",
      }
    : {
        blockers,
        nextAction: blockers[0]!.nextAction,
        status: "blocked",
      };
}

export function isValidE164PhoneNumber(phoneNumberE164: string) {
  return e164Pattern.test(phoneNumberE164);
}

export function normalizePhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/\D/g, "");
}

export function phoneNumbersMatch(left: string, right: string) {
  return normalizePhoneNumber(left) === normalizePhoneNumber(right);
}
