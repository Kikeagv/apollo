export const whatsappBusinessAppStatuses = [
  "active",
  "messenger-only",
  "not-installed",
  "not-willing",
] as const;

export type WhatsAppBusinessAppStatus =
  (typeof whatsappBusinessAppStatuses)[number];

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
] as const;
export type PhoneAssociation = (typeof phoneAssociations)[number];

export type KapsoWhatsAppPreflightInput = {
  clinicName: string;
  metaAuthority: MetaAuthorityStatus;
  numberAssociation: PhoneAssociation;
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
