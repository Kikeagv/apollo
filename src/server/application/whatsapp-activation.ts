import {
  evaluateWhatsAppActivationContract,
  validateWhatsAppActivationEvidence,
  type WhatsAppActivationContract,
  type WhatsAppActivationEvidence,
  type WhatsAppActivationEvidenceSource,
  type WhatsAppActivationIdentityStatus,
  type WhatsAppActivationMode,
  type WhatsAppActivationCriterionCode,
  type WhatsAppOwnerAccessStatus,
} from "~/domain/whatsapp-activation";
import type { KapsoWhatsAppOnboardingSnapshot } from "./kapso-onboarding";
import {
  evaluateWhatsAppOperationsTraffic,
  type WhatsAppOperationsSnapshot,
  type WhatsAppOperationsStore,
} from "./whatsapp-operations";

export type WhatsAppActivationEvidenceStore = {
  read(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<WhatsAppActivationEvidence[]>;
  record(input: {
    actorIdentityId: string;
    clinicId: string;
    criterionCode: WhatsAppActivationCriterionCode;
    evidenceReference: string | null;
    now: Date;
    pendingReason: string | null;
    provisioningEventId: string | null;
    source: WhatsAppActivationEvidenceSource;
  }): Promise<void>;
};

export type WhatsAppActivationContractDependencies = {
  evidenceStore: WhatsAppActivationEvidenceStore;
  onboardingStore: {
    read(input: {
      access: "superadmin";
      actorIdentityId: string;
      clinicId: string;
    }): Promise<KapsoWhatsAppOnboardingSnapshot>;
  };
  operationsStore: Pick<WhatsAppOperationsStore, "read">;
};

export type RecordWhatsAppActivationEvidenceInput = {
  actorIdentityId: string;
  clinicId: string;
  criterionCode: WhatsAppActivationCriterionCode;
  evidenceReference?: string | null;
  now?: Date;
  pendingReason?: string | null;
  source: WhatsAppActivationEvidenceSource;
  identityStatus: WhatsAppActivationIdentityStatus;
};

export async function getWhatsAppActivationContract(
  input: {
    actorIdentityId: string;
    clinicId: string;
    identityStatus: WhatsAppActivationIdentityStatus;
  },
  dependencies: WhatsAppActivationContractDependencies,
): Promise<WhatsAppActivationContract> {
  const [operations, onboarding, evidence] = await Promise.all([
    dependencies.operationsStore.read({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
    }),
    dependencies.onboardingStore.read({
      access: "superadmin",
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
    }),
    dependencies.evidenceStore.read({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
    }),
  ]);

  return buildContract({
    evidence,
    identityStatus: input.identityStatus,
    onboarding,
    operations,
  });
}

export async function recordWhatsAppActivationEvidence(
  input: RecordWhatsAppActivationEvidenceInput,
  dependencies: WhatsAppActivationContractDependencies,
) {
  const now = input.now ?? new Date();
  const operations = await dependencies.operationsStore.read({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
  const provisioningEventId =
    operations.connection?.provisioningEventId ?? null;
  const evidence = validateWhatsAppActivationEvidence({
    criterionCode: input.criterionCode,
    evidenceReference: input.evidenceReference,
    pendingReason: input.pendingReason,
    provisioningEventId,
    recordedAt: now,
    source: input.source,
  });

  await dependencies.evidenceStore.record({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    criterionCode: evidence.criterionCode,
    evidenceReference: evidence.evidenceReference,
    now,
    pendingReason: evidence.pendingReason ?? null,
    provisioningEventId,
    source: evidence.source,
  });

  return getWhatsAppActivationContract(
    {
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
      identityStatus: input.identityStatus,
    },
    dependencies,
  );
}

function buildContract(input: {
  evidence: WhatsAppActivationEvidence[];
  identityStatus: WhatsAppActivationIdentityStatus;
  onboarding: KapsoWhatsAppOnboardingSnapshot;
  operations: WhatsAppOperationsSnapshot;
}) {
  const requestedMode: WhatsAppActivationMode | null =
    input.onboarding.preflight?.onboardingMode ??
    (input.operations.connection?.connectionType === "coexistence" ||
    input.operations.connection?.connectionType === "dedicated"
      ? input.operations.connection.connectionType
      : null);
  const ownerAccess: WhatsAppOwnerAccessStatus =
    input.onboarding.ownerAccess ??
    (input.onboarding.ownerName === null ? "blocked" : "pending");

  return evaluateWhatsAppActivationContract({
    clinicId: input.operations.clinicId,
    clinicIsSynthetic: input.operations.clinicIsSynthetic,
    clinicName: input.operations.clinicName,
    connection:
      input.operations.connection === null
        ? null
        : {
            connectionType: input.operations.connection.connectionType,
            provider: input.operations.connection.provider,
            status: input.operations.connection.status,
          },
    currentProvisioningEventId:
      input.operations.connection?.provisioningEventId ?? null,
    evidence: input.evidence,
    identityStatus: input.identityStatus,
    ownerAccess,
    requestedMode,
    smoke:
      input.operations.latestSmoke === null
        ? {
            provisioningEventId: null,
            providerTransportVerified: false,
            realPatientsEnabled: false,
            status: "pending",
            controlledTestContact: false,
            syntheticContact: false,
          }
        : {
            provisioningEventId:
              input.operations.latestSmoke.provisioningEventId,
            providerTransportVerified:
              input.operations.latestSmoke.providerTransportVerified === true,
            realPatientsEnabled:
              input.operations.latestSmoke.realPatientsEnabled,
            status: input.operations.latestSmoke.status,
            controlledTestContact:
              input.operations.latestSmoke.controlledTestContact === true,
            syntheticContact: input.operations.latestSmoke.syntheticContact,
          },
    technicalReadiness: input.operations.technicalReadiness.status,
    trafficAllowed: evaluateWhatsAppOperationsTraffic(input.operations).allowed,
    trafficStatus: input.operations.trafficStatus,
  });
}
