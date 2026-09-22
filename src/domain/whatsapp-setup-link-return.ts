export const WHATSAPP_SETUP_LINK_RETURN_PATH = "/whatsapp/activacion/retorno";
export const WHATSAPP_CONFIGURATION_PATH = "/configuracion/whatsapp";

export const whatsappSetupLinkReturnStatuses = [
  "success",
  "cancelled",
  "failed",
  "pending",
  "expired",
] as const;

export type WhatsAppSetupLinkReturnStatus =
  (typeof whatsappSetupLinkReturnStatuses)[number];

export const whatsappSetupLinkReturnStatusLabels: Record<
  WhatsAppSetupLinkReturnStatus,
  string
> = {
  cancelled: "Activación cancelada",
  expired: "Enlace vencido",
  failed: "Activación no completada",
  pending: "Activación pendiente de verificación",
  success: "Activación recibida",
};

const whatsappSetupLinkReturnErrorCodes = new Set([
  "already_used",
  "facebook_auth_failed",
  "link_expired",
  "phone_verification_failed",
  "waba_limit_reached",
  "token_exchange_failed",
]);

/** Construye callbacks desde el origen público, sin conservar rutas internas. */
export function whatsappSetupLinkReturnUrl(appUrl: string) {
  const origin = new URL(appUrl).origin;
  return new URL(WHATSAPP_SETUP_LINK_RETURN_PATH, `${origin}/`).toString();
}

/** Conserva únicamente códigos conocidos del proveedor o del flujo interno. */
export function normalizeWhatsAppSetupLinkReturnErrorCode(
  value: string | null | undefined,
) {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") return null;
  return whatsappSetupLinkReturnErrorCodes.has(normalized) ? normalized : null;
}

/** Un error del redirect sólo se conserva si coincide con el estado de Kapso. */
export function confirmedWhatsAppSetupLinkReturnErrorCode(input: {
  errorCode: string | null | undefined;
  status: WhatsAppSetupLinkReturnStatus;
}) {
  const errorCode = normalizeWhatsAppSetupLinkReturnErrorCode(input.errorCode);
  if (input.status === "cancelled" && errorCode === "facebook_auth_failed") {
    return errorCode;
  }
  if (
    input.status === "failed" &&
    (errorCode === "phone_verification_failed" ||
      errorCode === "waba_limit_reached" ||
      errorCode === "token_exchange_failed")
  ) {
    return errorCode;
  }
  if (input.status === "expired" && errorCode === "link_expired") {
    return errorCode;
  }
  return null;
}

/**
 * Clasifica un retorno únicamente después de que el caso de uso haya
 * encontrado el mismo enlace en Kapso. Los parámetros del redirect no pueden
 * por sí solos producir un estado de éxito.
 */
export function classifyWhatsAppSetupLinkReturn(input: {
  localExpiresAt: Date;
  now: Date;
  providerLinkStatus: string;
  providerSetupStatus: string | null;
  verifiedAtProvider: boolean;
}): WhatsAppSetupLinkReturnStatus {
  if (!input.verifiedAtProvider) return "pending";

  if (
    input.providerLinkStatus === "expired" ||
    (input.providerLinkStatus === "active" && input.localExpiresAt <= input.now)
  ) {
    return "expired";
  }

  if (input.providerLinkStatus === "revoked") {
    return "cancelled";
  }

  if (input.providerSetupStatus === "failed") {
    return "failed";
  }

  if (input.providerSetupStatus === "completed") {
    return "success";
  }

  return "pending";
}

export function whatsappSetupLinkReturnNextAction(
  status: WhatsAppSetupLinkReturnStatus,
) {
  switch (status) {
    case "success":
      return "Espere la provisión automática del número y vuelva a la configuración de WhatsApp para verificar la Conexión.";
    case "cancelled":
      return "Vuelva a la configuración de WhatsApp y abra un nuevo enlace cuando esté listo para continuar.";
    case "failed":
      return "Revise el estado en Meta y genere un nuevo enlace desde la configuración de WhatsApp.";
    case "expired":
      return "Vuelva a la configuración de WhatsApp y genere un enlace nuevo.";
    case "pending":
      return "Espere unos instantes y recargue esta página; la Conexión solo estará lista cuando el servidor reciba la confirmación de Kapso.";
  }
}
