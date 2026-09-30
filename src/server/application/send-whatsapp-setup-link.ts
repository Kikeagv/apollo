import { isWhatsAppSetupLinkUsable } from "~/domain/whatsapp-setup-link";
import type { ClinicRegistrationStore } from "./clinic-registration";
import { manageKapsoWhatsAppSetupLink } from "./whatsapp-setup-links";
import type { KapsoWhatsAppOnboardingStore } from "./kapso-onboarding";
import type { KapsoOnboardingProvider } from "~/server/whatsapp/kapso-onboarding";

export type WhatsAppSetupLinkEmail = {
  clinicName: string;
  expiresAt: Date;
  ownerEmail: string;
  ownerName: string;
  setupLinkUrl: string;
};

export type SendWhatsAppSetupLinkResult = {
  deliveryStatus: "failed" | "sent";
  message: string;
  ownerEmail: string;
  snapshot: Awaited<ReturnType<KapsoWhatsAppOnboardingStore["read"]>>;
};

export async function sendWhatsAppSetupLinkToOwner(
  input: {
    action?: "send" | "regenerate";
    actorIdentityId: string;
    clinicId: string;
    reason?: string;
  },
  dependencies: {
    appUrl: string;
    emailSender: {
      sendWhatsAppSetupLink(input: WhatsAppSetupLinkEmail): Promise<void>;
    };
    onboardingStore: KapsoWhatsAppOnboardingStore;
    ownerStore: Pick<ClinicRegistrationStore, "read">;
    provider: KapsoOnboardingProvider;
    now?: () => Date;
  },
): Promise<SendWhatsAppSetupLinkResult> {
  const now = dependencies.now ?? (() => new Date());
  const registration = await dependencies.ownerStore.read({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
  const snapshot = await manageKapsoWhatsAppSetupLink(
    {
      action: input.action === "regenerate" ? "regenerate" : "generate",
      actorIdentityId: input.actorIdentityId,
      actorType: "superadmin",
      clinicId: input.clinicId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
    {
      appUrl: dependencies.appUrl,
      now,
      provider: dependencies.provider,
      store: dependencies.onboardingStore,
    },
  );

  if (
    snapshot.setupLink === null ||
    snapshot.setupLinkProviderId === null ||
    snapshot.customerId === null ||
    !isWhatsAppSetupLinkUsable(snapshot.setupLink, now())
  ) {
    throw new Error(
      "No hay un Enlace de configuración activo para enviar al propietario.",
    );
  }

  const deliveryEvent = async (event: {
    action: "setup-link-email-failed" | "setup-link-email-sent";
    reason: string;
    result: "failed" | "succeeded";
  }) => {
    await dependencies.onboardingStore.save({
      access: "superadmin",
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: event.action,
          customerId: snapshot.customerId,
          reason: event.reason,
          result: event.result,
          setupLinkId: snapshot.setupLinkProviderId,
        },
      ],
      clinicId: input.clinicId,
      customerId: snapshot.customerId,
    });
    return dependencies.onboardingStore.read({
      access: "superadmin",
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
    });
  };

  try {
    await dependencies.emailSender.sendWhatsAppSetupLink({
      clinicName: registration.clinic.name,
      expiresAt: snapshot.setupLink.expiresAt,
      ownerEmail: registration.invitation.email,
      ownerName: registration.invitation.recipientName,
      setupLinkUrl: snapshot.setupLink.url,
    });
  } catch {
    const updatedSnapshot = await deliveryEvent({
      action: "setup-link-email-failed",
      reason:
        "No se pudo entregar por correo el Enlace de configuración al propietario.",
      result: "failed",
    });
    return {
      deliveryStatus: "failed",
      message:
        "El enlace está activo, pero no se pudo enviar al propietario. Puedes reintentar el envío.",
      ownerEmail: registration.invitation.email,
      snapshot: updatedSnapshot,
    };
  }

  const updatedSnapshot = await deliveryEvent({
    action: "setup-link-email-sent",
    reason:
      "El Enlace de configuración se envió por correo al propietario de la Clínica.",
    result: "succeeded",
  });
  return {
    deliveryStatus: "sent",
    message: `Enlace de configuración enviado a ${registration.invitation.email}.`,
    ownerEmail: registration.invitation.email,
    snapshot: updatedSnapshot,
  };
}
