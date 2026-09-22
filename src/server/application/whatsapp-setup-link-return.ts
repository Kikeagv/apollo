import {
  classifyWhatsAppSetupLinkReturn,
  confirmedWhatsAppSetupLinkReturnErrorCode,
  whatsappSetupLinkReturnNextAction,
  type WhatsAppSetupLinkReturnStatus,
} from "~/domain/whatsapp-setup-link-return";
import type {
  KapsoOnboardingProvider,
  KapsoSetupLink,
} from "~/server/whatsapp/kapso-onboarding";

export type KapsoWhatsAppSetupLinkReturnRecord = {
  clinicId: string;
  customerId: string;
  expiresAt: Date;
  kapsoSetupLinkId: string;
  status: "active" | "used" | "expired" | "revoked";
};

export type KapsoWhatsAppSetupLinkReturnStore = {
  findSetupLinkByProviderId(
    providerSetupLinkId: string,
  ): Promise<KapsoWhatsAppSetupLinkReturnRecord | undefined>;
  recordSetupLinkReturn(input: {
    errorCode: string | null;
    returnedAt: Date;
    setupLinkId: string;
    status: WhatsAppSetupLinkReturnStatus;
  }): Promise<boolean>;
};

export type WhatsAppSetupLinkReturnResult = {
  connectionReady: false;
  errorCode: string | null;
  nextAction: string;
  setupLinkId: string | null;
  status: WhatsAppSetupLinkReturnStatus;
  verified: boolean;
};

export async function processWhatsAppSetupLinkReturn(
  input: {
    errorCode?: string | null;
    setupLinkId?: string | null;
    status?: string | null;
  },
  dependencies: {
    now?: () => Date;
    provider: Pick<KapsoOnboardingProvider, "listSetupLinks">;
    store: KapsoWhatsAppSetupLinkReturnStore;
  },
): Promise<WhatsAppSetupLinkReturnResult> {
  const setupLinkId = normalizedValue(input.setupLinkId);
  const now = dependencies.now?.() ?? new Date();

  if (setupLinkId === null) {
    return result("failed", {
      errorCode: "missing-setup-link-id",
      setupLinkId: null,
      verified: false,
    });
  }

  const localLink =
    await dependencies.store.findSetupLinkByProviderId(setupLinkId);
  if (localLink === undefined) {
    return result("failed", {
      errorCode: "unknown-setup-link",
      setupLinkId,
      verified: false,
    });
  }

  let remoteLink: KapsoSetupLink | undefined;
  try {
    remoteLink = (
      await dependencies.provider.listSetupLinks(localLink.customerId)
    ).find((link) => link.id === setupLinkId);
  } catch {
    return result("pending", {
      errorCode: "provider-unavailable",
      setupLinkId,
      verified: false,
    });
  }

  if (remoteLink === undefined) {
    return result("pending", {
      errorCode: "provider-link-not-found",
      setupLinkId,
      verified: false,
    });
  }

  const status = classifyWhatsAppSetupLinkReturn({
    localExpiresAt: localLink.expiresAt,
    now,
    providerLinkStatus: remoteLink.status,
    providerSetupStatus: remoteLink.whatsappSetupStatus,
    verifiedAtProvider: true,
  });
  const errorCode = confirmedWhatsAppSetupLinkReturnErrorCode({
    errorCode: input.errorCode,
    status,
  });
  await dependencies.store.recordSetupLinkReturn({
    errorCode,
    returnedAt: now,
    setupLinkId,
    status,
  });
  return result(status, {
    errorCode,
    setupLinkId,
    verified: true,
  });
}

function normalizedValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? null : normalized;
}

function result(
  status: WhatsAppSetupLinkReturnStatus,
  input: {
    errorCode: string | null;
    setupLinkId: string | null;
    verified: boolean;
  },
): WhatsAppSetupLinkReturnResult {
  return {
    connectionReady: false,
    errorCode: input.errorCode,
    nextAction: whatsappSetupLinkReturnNextAction(status),
    setupLinkId: input.setupLinkId,
    status,
    verified: input.verified,
  };
}
