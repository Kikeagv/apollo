import type { WhatsAppConnection } from "~/domain/whatsapp-connection";
import {
  evaluateKapsoWhatsAppPreflight,
  isValidE164PhoneNumber,
  type KapsoWhatsAppPreflightInput,
  type MetaAuthorityStatus,
  type WhatsAppBusinessAppStatus,
  type WhatsAppPreflightBlocker,
  type WhatsAppPreflightChecks,
  type WhatsAppPreflightStatus,
} from "~/domain/whatsapp-preflight";
import {
  KapsoProviderError,
  KapsoProviderUnavailableError,
  type KapsoCustomer,
  type KapsoOnboardingProvider,
} from "~/server/whatsapp/kapso-onboarding";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";

export type KapsoWhatsAppPreflightSnapshot = {
  blockers: WhatsAppPreflightBlocker[];
  checkedAt: Date | null;
  checks: WhatsAppPreflightChecks | null;
  nextAction: string;
  reason: string | null;
  status: WhatsAppPreflightStatus;
};

export type KapsoWhatsAppOnboardingSnapshot = {
  clinicId: string;
  clinicName: string;
  connection: WhatsAppConnection | null;
  customerId: string | null;
  ownerName: string | null;
  preflight: KapsoWhatsAppPreflightSnapshot | null;
};

export type KapsoWhatsAppOnboardingAuditEvent = {
  action:
    | "customer-confirmed"
    | "customer-created"
    | "onboarding-provider-unavailable"
    | "preflight-executed";
  customerId: string | null;
  reason: string;
  result: "blocked" | "failed" | "succeeded";
};

export type KapsoWhatsAppConnectionUpdate = {
  connectionType: "coexistence";
  metadata: Record<string, string | null>;
  phoneNumberE164: string | null;
  phoneNumberId: string | null;
  provider: "kapso";
  status: "blocked" | "pending";
};

export type KapsoWhatsAppOnboardingStore = {
  read(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<KapsoWhatsAppOnboardingSnapshot>;
  save(input: {
    actorIdentityId: string;
    auditEvents: KapsoWhatsAppOnboardingAuditEvent[];
    clinicId: string;
    connection?: KapsoWhatsAppConnectionUpdate;
    customerId: string | null;
    preflight: {
      blockers: WhatsAppPreflightBlocker[];
      checkedAt: Date;
      checks: WhatsAppPreflightChecks;
      nextAction: string;
      reason: string | null;
      status: WhatsAppPreflightStatus;
    };
  }): Promise<void>;
};

export type PrepareKapsoWhatsAppOnboardingInput = {
  actorIdentityId: string;
  clinicId: string;
  metaAuthority: MetaAuthorityStatus;
  numberOwnedByClinic: boolean;
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

export function getKapsoWhatsAppOnboarding(
  input: { actorIdentityId: string; clinicId: string },
  store: KapsoWhatsAppOnboardingStore = drizzleKapsoOnboardingStore,
) {
  return store.read(input);
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
  const externalCustomerId = `praxia-clinic:${input.clinicId}`;
  const localPreflightInput = createPreflightInput(
    input,
    current,
    "not-checked",
  );
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

    const phone = await findPhoneAssociation(
      dependencies.provider,
      input.phoneNumberE164,
      input.numberOwnedByClinic,
      customer.id,
    );
    const preflightInput = createPreflightInput(
      input,
      current,
      phone.association,
    );
    const evaluation = evaluateKapsoWhatsAppPreflight(preflightInput);
    const checkedAt = now();
    const readyConnection =
      current.connection?.provider === "kapso" &&
      current.connection.status === "ready"
        ? current.connection
        : null;
    if (readyConnection !== null && readyConnection.customer !== customer.id) {
      throw new Error(
        "La Conexión de WhatsApp lista pertenece a otro customer de Kapso",
      );
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
      ...(readyConnection !== null
        ? {}
        : {
            connection: {
              connectionType: "coexistence" as const,
              metadata: {
                mode: "coexistence",
                source: "kapso-onboarding",
                displayPhoneE164:
                  phone.association === "other-customer"
                    ? null
                    : isValidE164PhoneNumber(input.phoneNumberE164) &&
                        input.numberOwnedByClinic
                      ? input.phoneNumberE164
                      : null,
              },
              phoneNumberE164:
                phone.association === "other-customer"
                  ? null
                  : isValidE164PhoneNumber(input.phoneNumberE164) &&
                      input.numberOwnedByClinic
                    ? input.phoneNumberE164
                    : null,
              phoneNumberId:
                phone.association === "same-customer"
                  ? phone.phoneNumberId
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
  numberAssociation: KapsoWhatsAppPreflightInput["numberAssociation"],
): KapsoWhatsAppPreflightInput {
  const persistedOwnerName = current.ownerName?.trim();
  const ownerMatchesClinic =
    persistedOwnerName !== undefined &&
    normalizeOwnerName(persistedOwnerName) ===
      normalizeOwnerName(input.ownerName);

  return {
    clinicName: current.clinicName,
    metaAuthority: input.metaAuthority,
    numberAssociation,
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
    return { action: "customer-confirmed" as const, customer: existing };
  }

  try {
    return {
      action: "customer-created" as const,
      customer: await provider.createCustomer({ externalCustomerId, name }),
    };
  } catch (error) {
    if (!isConflict(error)) throw error;
    const createdByAnotherAttempt =
      await provider.findCustomerByExternalId(externalCustomerId);
    if (createdByAnotherAttempt === undefined) throw error;
    return {
      action: "customer-confirmed" as const,
      customer: createdByAnotherAttempt,
    };
  }
}

async function findPhoneAssociation(
  provider: KapsoOnboardingProvider,
  phoneNumberE164: string,
  numberOwnedByClinic: boolean,
  customerId: string,
) {
  if (!numberOwnedByClinic || !isValidE164PhoneNumber(phoneNumberE164)) {
    return { association: "not-checked" as const, phoneNumberId: null };
  }

  const normalizedInput = normalizePhoneNumber(phoneNumberE164);
  const matchingPhone = (await provider.listPhoneNumbers()).find(
    (phoneNumber) =>
      normalizePhoneNumber(
        phoneNumber.displayPhoneNumberNormalized ??
          phoneNumber.displayPhoneNumber ??
          "",
      ) === normalizedInput,
  );
  if (matchingPhone === undefined) {
    return { association: "available" as const, phoneNumberId: null };
  }
  return {
    association:
      matchingPhone.customerId === customerId
        ? ("same-customer" as const)
        : ("other-customer" as const),
    phoneNumberId: matchingPhone.phoneNumberId,
  };
}

function normalizePhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/\D/g, "");
}

function toPersistedChecks(
  input: KapsoWhatsAppPreflightInput,
): WhatsAppPreflightChecks {
  return {
    metaAuthority: input.metaAuthority,
    numberAssociation: input.numberAssociation,
    numberOwnedByClinic: input.numberOwnedByClinic,
    ownerConfirmed: input.ownerConfirmed,
    phoneNumberE164: input.phoneNumberE164,
    qrDeviceAvailable: input.qrDeviceAvailable,
    whatsappBusinessApp: input.whatsappBusinessApp,
  };
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
