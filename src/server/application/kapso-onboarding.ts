import type { WhatsAppConnection } from "~/domain/whatsapp-connection";
import type { WhatsAppOwnerAccessStatus } from "~/domain/whatsapp-activation";
import type {
  WhatsAppSetupLink,
  WhatsAppSetupLinkStatus,
} from "~/domain/whatsapp-setup-link";
import { whatsappSetupLinkStatus } from "~/domain/whatsapp-setup-link";
import {
  evaluateKapsoWhatsAppPreflight,
  isValidE164PhoneNumber,
  normalizePhoneNumber,
  phoneNumbersMatch,
  type KapsoWhatsAppPreflightInput,
  type MetaAuthorityStatus,
  type WhatsAppBusinessAppStatus,
  type WhatsAppPreflightBlocker,
  type WhatsAppPreflightChecks,
  type WhatsAppOnboardingMode,
  type WhatsAppPreflightStatus,
} from "~/domain/whatsapp-preflight";
import {
  KapsoProviderError,
  KapsoProviderUnavailableError,
  type KapsoCustomer,
  type KapsoOnboardingProvider,
  type KapsoSetupLink,
  type KapsoSetupLinkProviderStatus,
} from "~/server/whatsapp/kapso-onboarding";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import type { WhatsAppSetupLinkReturnStatus } from "~/domain/whatsapp-setup-link-return";

export type KapsoWhatsAppPreflightSnapshot = {
  blockers: WhatsAppPreflightBlocker[];
  checkedAt: Date | null;
  checks: WhatsAppPreflightChecks | null;
  onboardingMode?: WhatsAppOnboardingMode;
  nextAction: string;
  reason: string | null;
  status: WhatsAppPreflightStatus;
};

export type KapsoWhatsAppOnboardingSnapshot = {
  clinicId: string;
  clinicName: string;
  connection: WhatsAppConnection | null;
  customerId: string | null;
  ownerAccess?: WhatsAppOwnerAccessStatus;
  ownerName: string | null;
  preflight: KapsoWhatsAppPreflightSnapshot | null;
  setupLink: WhatsAppSetupLink | null;
  setupLinkHistory: KapsoWhatsAppSetupLinkAuditEvent[];
  setupLinkProviderError: string | null;
  setupLinkProviderId: string | null;
  setupLinkProviderStatus: KapsoSetupLinkProviderStatus | null;
  setupLinkReturn?: {
    errorCode: string | null;
    returnedAt: Date;
    status: WhatsAppSetupLinkReturnStatus;
  } | null;
};

export type KapsoWhatsAppSetupLinkAuditEvent = {
  action:
    | "setup-link-confirmed"
    | "setup-link-created"
    | "setup-link-expired"
    | "setup-link-provider-unavailable"
    | "setup-link-regenerated"
    | "setup-link-revoked"
    | "setup-link-used";
  actorIdentityId: string;
  occurredAt: Date;
  reason: string;
  result: "blocked" | "failed" | "succeeded";
  setupLinkId: string | null;
};

export type KapsoWhatsAppOnboardingAuditEvent = {
  action:
    | "customer-confirmed"
    | "customer-created"
    | "onboarding-provider-unavailable"
    | "offboarding-authorized"
    | "preflight-executed"
    | "setup-link-confirmed"
    | "setup-link-created"
    | "setup-link-expired"
    | "setup-link-provider-unavailable"
    | "setup-link-regenerated"
    | "setup-link-revoked"
    | "setup-link-used";
  customerId: string | null;
  reason: string;
  result: "blocked" | "failed" | "succeeded";
  setupLinkId?: string | null;
};

export type KapsoWhatsAppConnectionUpdate = {
  connectionType: "coexistence" | "dedicated";
  metadata: Record<string, string | null>;
  phoneNumberE164: string | null;
  phoneNumberId: string | null;
  provider: "kapso";
  status: "blocked" | "pending";
};

export type KapsoWhatsAppSetupLinkUpdate = {
  createdAt: Date;
  expiresAt: Date;
  kapsoSetupLinkId: string;
  lastReturnErrorCode?: string | null;
  lastReturnStatus?: WhatsAppSetupLinkReturnStatus | null;
  lastReturnedAt?: Date | null;
  providerError: string | null;
  providerStatus: KapsoSetupLinkProviderStatus | null;
  revokedAt: Date | null;
  status: WhatsAppSetupLinkStatus;
  url: string;
  usedAt: Date | null;
};

export type KapsoWhatsAppOnboardingStore = {
  read(input: {
    access?: "clinic-owner" | "superadmin";
    actorIdentityId: string;
    clinicId: string;
  }): Promise<KapsoWhatsAppOnboardingSnapshot>;
  save(input: {
    access?: "clinic-owner" | "superadmin";
    actorIdentityId: string;
    auditEvents: KapsoWhatsAppOnboardingAuditEvent[];
    clinicId: string;
    connection?: KapsoWhatsAppConnectionUpdate;
    customerId: string | null;
    preflight?: {
      blockers: WhatsAppPreflightBlocker[];
      checkedAt: Date;
      checks: WhatsAppPreflightChecks;
      onboardingMode?: WhatsAppOnboardingMode;
      nextAction: string;
      reason: string | null;
      status: WhatsAppPreflightStatus;
    };
    setupLink?: KapsoWhatsAppSetupLinkUpdate;
  }): Promise<void>;
};

export type PrepareKapsoWhatsAppOnboardingInput = {
  actorIdentityId: string;
  clinicId: string;
  metaAuthority: MetaAuthorityStatus;
  numberOwnedByClinic: boolean;
  onboardingMode?: WhatsAppOnboardingMode;
  ownerConfirmed: boolean;
  ownerName: string;
  phoneNumberE164: string;
  qrDeviceAvailable: boolean;
  whatsappBusinessApp: WhatsAppBusinessAppStatus;
};

type KapsoOnboardingDependencies = {
  provider: KapsoOnboardingProvider;
  store: KapsoWhatsAppOnboardingStore;
  now?: () => Date;
};

const providerUnavailableNextAction =
  "Reintentar cuando Kapso esté disponible para confirmar el customer y ejecutar el preflight.";
const providerUnavailableReason =
  "Kapso no está disponible para el onboarding.";

export async function getKapsoWhatsAppOnboarding(
  input: {
    access?: "clinic-owner" | "superadmin";
    actorIdentityId: string;
    clinicId: string;
  },
  store: KapsoWhatsAppOnboardingStore = drizzleKapsoOnboardingStore,
  provider?: KapsoOnboardingProvider,
) {
  const snapshot = await store.read(input);
  if (
    provider === undefined ||
    snapshot.customerId === null ||
    snapshot.setupLink === null ||
    snapshot.setupLinkProviderId === null
  ) {
    return snapshot;
  }
  const setupLink = snapshot.setupLink;
  const setupLinkProviderId = snapshot.setupLinkProviderId;

  try {
    const remoteLink = (
      await provider.listSetupLinks(snapshot.customerId)
    ).find((link) => link.id === setupLinkProviderId);

    const now = new Date();
    if (remoteLink === undefined) {
      const localStatus = whatsappSetupLinkStatus(setupLink, now);
      const shouldPersistExpired =
        localStatus === "expired" && setupLink.status === "active";
      if (localStatus === "used" || localStatus === "revoked") {
        return snapshot;
      }
      if (!shouldPersistExpired && localStatus !== "active") {
        return snapshot;
      }
      const status = shouldPersistExpired ? "expired" : "revoked";
      await store.save({
        access: input.access,
        actorIdentityId: input.actorIdentityId,
        auditEvents: [
          {
            action: setupLinkStatusAuditAction(status),
            customerId: snapshot.customerId,
            reason:
              status === "expired"
                ? "El enlace alcanzó su fecha de vencimiento y ya no está disponible en Kapso."
                : "Kapso ya no reporta el enlace de configuración activo.",
            result: "succeeded",
            setupLinkId: setupLinkProviderId,
          },
        ],
        clinicId: input.clinicId,
        customerId: snapshot.customerId,
        setupLink: {
          createdAt: setupLink.createdAt,
          expiresAt: setupLink.expiresAt,
          kapsoSetupLinkId: setupLinkProviderId,
          providerError: null,
          providerStatus: null,
          revokedAt: status === "revoked" ? now : setupLink.revokedAt,
          status,
          url: setupLink.url,
          usedAt: setupLink.usedAt,
        },
      });
      return store.read(input);
    }

    const status = whatsappSetupLinkStatus(remoteLink, now);
    if (
      setupLink.status === status &&
      setupLink.expiresAt.getTime() === remoteLink.expiresAt.getTime() &&
      setupLink.url === remoteLink.url &&
      snapshot.setupLinkProviderError === remoteLink.whatsappSetupError &&
      snapshot.setupLinkProviderStatus === remoteLink.whatsappSetupStatus
    ) {
      return snapshot;
    }

    await store.save({
      access: input.access,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: setupLinkStatusAuditAction(status),
          customerId: snapshot.customerId,
          reason: "Kapso actualizó el estado del enlace de configuración.",
          result: "succeeded",
          setupLinkId: remoteLink.id,
        },
      ],
      clinicId: input.clinicId,
      customerId: snapshot.customerId,
      setupLink: toSetupLinkUpdate(remoteLink, now),
    });
    return store.read(input);
  } catch (error) {
    if (isProviderFailure(error)) return snapshot;
    throw error;
  }
}

export async function prepareKapsoWhatsAppOnboarding(
  input: PrepareKapsoWhatsAppOnboardingInput,
  dependencies: KapsoOnboardingDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const current = await dependencies.store.read({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
  const onboardingMode =
    input.onboardingMode ??
    (current.connection?.provider === "kapso" &&
    current.connection.connectionType === "dedicated"
      ? "dedicated"
      : current.preflight?.onboardingMode ?? "coexistence");
  const localPreflightInput = createPreflightInput(
    input,
    current,
    {
      association: "not-checked",
      numberConnectionType: "unknown",
      phoneNumberId: null,
    },
    onboardingMode === "dedicated" ? "dedicated" : "coexistence",
  );

  if (onboardingMode === "later" || onboardingMode === "not-integrated") {
    if (
      current.customerId !== null ||
      current.setupLink !== null ||
      current.connection?.provider === "kapso"
    ) {
      throw new Error(
        "La Clínica ya tiene una configuración Kapso; autoriza el offboarding antes de dejar WhatsApp pendiente.",
      );
    }
    const checkedAt = now();
    const reason =
      onboardingMode === "later"
        ? "La Clínica se creó correctamente y la activación de WhatsApp quedó pendiente."
        : "La Clínica se creó correctamente sin integración de WhatsApp.";
    await dependencies.store.save({
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "preflight-executed",
          customerId: current.customerId,
          reason,
          result: "succeeded",
        },
      ],
      clinicId: input.clinicId,
      customerId: current.customerId,
      preflight: {
        blockers: [],
        checkedAt,
        checks: toPersistedChecks(localPreflightInput),
        onboardingMode,
        nextAction:
          onboardingMode === "later"
            ? "Iniciar la activación de WhatsApp cuando la Clínica esté lista."
            : "No hay ninguna acción de WhatsApp pendiente.",
        reason,
        status: "not-run",
      },
    });
    return dependencies.store.read({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
    });
  }

  const externalCustomerId = `praxia-clinic:${input.clinicId}`;
  const localEvaluation = evaluateKapsoWhatsAppPreflight(localPreflightInput);

  let customer: KapsoCustomer | undefined;
  let customerAction: "customer-confirmed" | "customer-created";
  try {
    const customerResult = await findOrCreateCustomer(
      dependencies.provider,
      externalCustomerId,
      current.clinicName,
    );
    customer = customerResult.customer;
    customerAction = customerResult.action;

    const phoneResolution = await findPhoneAssociation(
      dependencies.provider,
      input.phoneNumberE164,
      input.numberOwnedByClinic,
      customer.id,
    );
    const preflightInput = createPreflightInput(
      input,
      current,
      phoneResolution,
      onboardingMode,
    );
    const evaluation = evaluateKapsoWhatsAppPreflight(preflightInput);
    const checkedAt = now();
    const canPersistPhoneNumber =
      phoneResolution.association === "same-customer" ||
      (evaluation.status === "passed" &&
        phoneResolution.association === "available");
    const persistedPhoneNumber =
      canPersistPhoneNumber &&
      isValidE164PhoneNumber(input.phoneNumberE164) &&
      input.numberOwnedByClinic
        ? input.phoneNumberE164
        : null;
    const kapsoConnection =
      current.connection?.provider === "kapso" ? current.connection : null;
    if (kapsoConnection !== null) {
      if (kapsoConnection.customer !== customer.id) {
        throw new Error(
          "La Conexión de WhatsApp Kapso pertenece a otro customer de Kapso",
        );
      }
      assertSameConfiguredPhone(kapsoConnection, input.phoneNumberE164);
      assertSameConfiguredPhoneAssociation(kapsoConnection, phoneResolution);
      if (kapsoConnection.connectionType !== onboardingMode) {
        throw new Error(
          "La Conexión de WhatsApp debe conservar su modalidad original",
        );
      }
    }

    await dependencies.store.save({
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: customerAction,
          customerId: customer.id,
          reason:
            customerAction === "customer-created"
              ? "Customer de Kapso creado para la Clínica."
              : "Customer de Kapso confirmado para la Clínica.",
          result: "succeeded",
        },
        {
          action: "preflight-executed",
          customerId: customer.id,
          reason:
            evaluation.status === "passed"
              ? "Preflight completado sin bloqueos conocidos."
              : evaluation.blockers.map((blocker) => blocker.message).join(" "),
          result: evaluation.status === "passed" ? "succeeded" : "blocked",
        },
      ],
      clinicId: input.clinicId,
      ...(kapsoConnection?.status === "ready"
        ? {}
        : {
            connection: {
              connectionType: onboardingMode,
              metadata: {
                mode: onboardingMode,
                source: "kapso-onboarding",
                displayPhoneE164: persistedPhoneNumber,
              },
              phoneNumberE164: persistedPhoneNumber,
              phoneNumberId:
                phoneResolution.association === "same-customer"
                  ? phoneResolution.phoneNumberId
                  : null,
              provider: "kapso" as const,
              status: evaluation.status === "passed" ? "pending" : "blocked",
            },
          }),
      customerId: customer.id,
      preflight: {
        blockers: evaluation.blockers,
        checkedAt,
        checks: toPersistedChecks(preflightInput),
        onboardingMode,
        nextAction: evaluation.nextAction,
        reason: null,
        status: evaluation.status,
      },
    });
  } catch (error) {
    if (!isProviderFailure(error)) throw error;

    const checkedAt = now();
    await dependencies.store.save({
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "onboarding-provider-unavailable",
          customerId: customer?.id ?? null,
          reason: providerUnavailableReason,
          result: "failed",
        },
      ],
      clinicId: input.clinicId,
      customerId: customer?.id ?? null,
      preflight: {
        blockers: localEvaluation.blockers,
        checkedAt,
        checks: toPersistedChecks(localPreflightInput),
        onboardingMode,
        nextAction:
          localEvaluation.blockers[0]?.nextAction ??
          providerUnavailableNextAction,
        reason: providerUnavailableReason,
        status: "unavailable",
      },
    });
  }

  return dependencies.store.read({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
}

function createPreflightInput(
  input: PrepareKapsoWhatsAppOnboardingInput,
  current: KapsoWhatsAppOnboardingSnapshot,
  phoneResolution: PhoneAssociationResult,
  onboardingMode: "coexistence" | "dedicated",
): KapsoWhatsAppPreflightInput {
  const persistedOwnerName = current.ownerName?.trim();
  const ownerMatchesClinic =
    persistedOwnerName !== undefined &&
    normalizeOwnerName(persistedOwnerName) ===
      normalizeOwnerName(input.ownerName);

  return {
    clinicName: current.clinicName,
    onboardingMode,
    metaAuthority: input.metaAuthority,
    numberAssociation: phoneResolution.association,
    numberConnectionType: phoneResolution.numberConnectionType,
    numberOwnedByClinic: input.numberOwnedByClinic,
    ownerConfirmed: input.ownerConfirmed && ownerMatchesClinic,
    ownerName: persistedOwnerName ?? "",
    phoneNumberE164: input.phoneNumberE164,
    qrDeviceAvailable: input.qrDeviceAvailable,
    whatsappBusinessApp: input.whatsappBusinessApp,
  };
}

function normalizeOwnerName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function findOrCreateCustomer(
  provider: KapsoOnboardingProvider,
  externalCustomerId: string,
  name: string,
) {
  const existing = await provider.findCustomerByExternalId(externalCustomerId);
  if (existing !== undefined) {
    assertCustomerIdentity(existing, externalCustomerId);
    return { action: "customer-confirmed" as const, customer: existing };
  }

  try {
    const created = await provider.createCustomer({ externalCustomerId, name });
    assertCustomerIdentity(created, externalCustomerId);
    return {
      action: "customer-created" as const,
      customer: created,
    };
  } catch (error) {
    if (!isConflict(error)) throw error;
    const createdByAnotherAttempt =
      await provider.findCustomerByExternalId(externalCustomerId);
    if (createdByAnotherAttempt === undefined) throw error;
    assertCustomerIdentity(createdByAnotherAttempt, externalCustomerId);
    return {
      action: "customer-confirmed" as const,
      customer: createdByAnotherAttempt,
    };
  }
}

type PhoneAssociationResult = {
  association: KapsoWhatsAppPreflightInput["numberAssociation"];
  numberConnectionType: KapsoWhatsAppPreflightInput["numberConnectionType"];
  phoneNumberId: string | null;
};

async function findPhoneAssociation(
  provider: KapsoOnboardingProvider,
  phoneNumberE164: string,
  numberOwnedByClinic: boolean,
  customerId: string,
): Promise<PhoneAssociationResult> {
  if (!numberOwnedByClinic || !isValidE164PhoneNumber(phoneNumberE164)) {
    return {
      association: "not-checked" as const,
      numberConnectionType: "unknown" as const,
      phoneNumberId: null,
    };
  }

  const normalizedInput = normalizePhoneNumber(phoneNumberE164);
  const phoneNumbers = await provider.listPhoneNumbers();
  if (
    phoneNumbers.some(
      (phoneNumber) =>
        normalizePhoneNumber(phoneNumberForComparison(phoneNumber)) === "",
    )
  ) {
    return {
      association: "ambiguous" as const,
      numberConnectionType: "unknown" as const,
      phoneNumberId: null,
    };
  }
  const matchingPhones = phoneNumbers.filter(
    (phoneNumber) =>
      normalizePhoneNumber(phoneNumberForComparison(phoneNumber)) ===
      normalizedInput,
  );
  if (matchingPhones.length === 0) {
    if (
      phoneNumbers.some((phoneNumber) => phoneNumber.customerId === customerId)
    ) {
      return {
        association: "same-customer-other-number" as const,
        numberConnectionType: "unknown" as const,
        phoneNumberId: null,
      };
    }
    return {
      association: "available" as const,
      numberConnectionType: "unknown" as const,
      phoneNumberId: null,
    };
  }
  if (matchingPhones.length > 1) {
    return {
      association: matchingPhones.some(
        (phoneNumber) => phoneNumber.customerId !== customerId,
      )
        ? ("other-customer" as const)
        : ("ambiguous" as const),
      numberConnectionType: "unknown" as const,
      phoneNumberId: null,
    };
  }
  const matchingPhone = matchingPhones[0]!;
  if (
    matchingPhone.customerId === customerId &&
    phoneNumbers.filter((phoneNumber) => phoneNumber.customerId === customerId)
      .length > 1
  ) {
    return {
      association: "same-customer-other-number" as const,
      numberConnectionType: "unknown" as const,
      phoneNumberId: null,
    };
  }
  return {
    association:
      matchingPhone.customerId === customerId
        ? ("same-customer" as const)
        : ("other-customer" as const),
    numberConnectionType:
      matchingPhone.isCoexistence === true
        ? ("coexistence" as const)
        : matchingPhone.isCoexistence === false
          ? ("dedicated" as const)
          : ("unknown" as const),
    phoneNumberId: matchingPhone.phoneNumberId,
  };
}

function phoneNumberForComparison(input: {
  displayPhoneNumber: string | null;
  displayPhoneNumberNormalized: string | null;
}) {
  const normalized = input.displayPhoneNumberNormalized?.trim();
  return normalized === undefined || normalized === ""
    ? (input.displayPhoneNumber ?? "")
    : normalized;
}

function toPersistedChecks(
  input: KapsoWhatsAppPreflightInput,
): WhatsAppPreflightChecks {
  return {
    metaAuthority: input.metaAuthority,
    numberAssociation: input.numberAssociation,
    numberConnectionType: input.numberConnectionType,
    numberOwnedByClinic: input.numberOwnedByClinic,
    ownerConfirmed: input.ownerConfirmed,
    phoneNumberE164: input.phoneNumberE164,
    qrDeviceAvailable: input.qrDeviceAvailable,
    whatsappBusinessApp: input.whatsappBusinessApp,
  };
}

function assertCustomerIdentity(
  customer: KapsoCustomer,
  externalCustomerId: string,
) {
  if (customer.externalCustomerId !== externalCustomerId) {
    throw new Error("Kapso devolvió un customer distinto al solicitado");
  }
}

function assertSameConfiguredPhone(
  connection: WhatsAppConnection,
  phoneNumberE164: string,
) {
  if (!isExistingKapsoConfiguration(connection)) return;
  if (connection.phoneNumberId === null) {
    throw new Error(
      "La reconexión de WhatsApp requiere conservar el phone number ID productivo",
    );
  }
  if (
    connection.phoneNumberE164 === null ||
    !phoneNumbersMatch(connection.phoneNumberE164, phoneNumberE164)
  ) {
    throw new Error(
      "La reconexión de WhatsApp debe usar el mismo número productivo ya configurado",
    );
  }
}

function assertSameConfiguredPhoneAssociation(
  connection: WhatsAppConnection,
  phone: PhoneAssociationResult,
) {
  if (!isExistingKapsoConfiguration(connection)) return;
  if (phone.association !== "same-customer") {
    throw new Error(
      "Kapso no confirmó la asociación del mismo número productivo para reconectar WhatsApp",
    );
  }
  if (
    connection.phoneNumberId !== null &&
    phone.phoneNumberId !== connection.phoneNumberId
  ) {
    throw new Error(
      "La reconexión de WhatsApp debe conservar la misma configuración productiva",
    );
  }
}

export function isExistingKapsoConfiguration(connection: WhatsAppConnection) {
  return (
    connection.provider === "kapso" &&
    (connection.phoneNumberId !== null ||
      (connection.phoneNumberE164 !== null &&
        ["degraded", "disconnected", "provisioning", "ready"].includes(
          connection.status,
        )))
  );
}

function toSetupLinkUpdate(
  link: KapsoSetupLink,
  now: Date,
): KapsoWhatsAppSetupLinkUpdate {
  const status = whatsappSetupLinkStatus(link, now);
  return {
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    kapsoSetupLinkId: link.id,
    providerError: link.whatsappSetupError,
    providerStatus: link.whatsappSetupStatus,
    revokedAt: status === "revoked" ? now : null,
    status,
    url: link.url,
    usedAt: status === "used" ? now : null,
  };
}

function setupLinkStatusAuditAction(
  status: WhatsAppSetupLinkStatus,
): KapsoWhatsAppOnboardingAuditEvent["action"] {
  if (status === "active") return "setup-link-confirmed";
  if (status === "used") return "setup-link-used";
  if (status === "expired") return "setup-link-expired";
  return "setup-link-revoked";
}

function isConflict(error: unknown) {
  return error instanceof KapsoProviderError
    ? error.status === 409
    : typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error as { status?: unknown }).status === 409;
}

function isProviderFailure(error: unknown) {
  return (
    error instanceof KapsoProviderError ||
    error instanceof KapsoProviderUnavailableError
  );
}
