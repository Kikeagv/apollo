import { describe, expect, it, vi } from "vitest";

import {
  getWhatsAppActivationContract,
  recordWhatsAppActivationEvidence,
  type WhatsAppActivationEvidenceStore,
} from "./whatsapp-activation";
import type { WhatsAppActivationEvidence } from "~/domain/whatsapp-activation";
import type { KapsoWhatsAppOnboardingSnapshot } from "./kapso-onboarding";
import type {
  WhatsAppOperationsSnapshot,
  WhatsAppOperationsStore,
} from "./whatsapp-operations";

const now = new Date("2026-09-16T12:00:00.000Z");
const clinicId = "00000000-0000-0000-0000-000000000094";
const actorIdentityId = "superadmin-apo-94";

function makeOperationsSnapshot(): WhatsAppOperationsSnapshot {
  return {
    circuitStatus: "closed",
    clinicId,
    clinicIsSynthetic: false,
    clinicName: "Clínica APO-94",
    connection: {
      businessAccountId: "waba-94",
      connectionType: "coexistence",
      customer: "customer-94",
      phoneNumberE164: "+50370000094",
      phoneNumberId: "phone-94",
      phoneNumberWebhookId: "phone-webhook-94",
      provisioningEventId: "generation-94",
      projectId: "project-94",
      projectWebhookId: "project-webhook-94",
      provider: "kapso",
      status: "ready",
      updatedAt: now,
    },
    gates: {},
    latestSmoke: {
      blockers: [],
      evidence: "Smoke sintético completo",
      finishedAt: now,
      id: "smoke-94",
      provisioningEventId: "generation-94",
      providerTransportVerified: true,
      realPatientsEnabled: false,
      startedAt: now,
      status: "passed",
      steps: [],
      syntheticContact: true,
    },
    offboarding: null,
    offboardingAuthorization: null,
    setupLinks: [],
    technicalReadiness: { blockers: [], status: "ready" },
    trafficStatus: "blocked",
  };
}

function makeOnboardingSnapshot(): KapsoWhatsAppOnboardingSnapshot {
  return {
    clinicId,
    clinicName: "Clínica APO-94",
    connection: null,
    customerId: "customer-94",
    ownerAccess: "ready",
    ownerName: "Dra. APO-94",
    preflight: {
      blockers: [],
      checkedAt: now,
      checks: null,
      nextAction: "Generar el Enlace",
      onboardingMode: "coexistence",
      reason: null,
      status: "passed",
    },
    setupLink: null,
    setupLinkHistory: [],
    setupLinkProviderError: null,
    setupLinkProviderId: null,
    setupLinkProviderStatus: null,
  };
}

function makeDependencies(
  persistedEvidence: WhatsAppActivationEvidence[] = [],
) {
  const operationsRead = vi.fn().mockResolvedValue(makeOperationsSnapshot());
  const operationsStore: Pick<WhatsAppOperationsStore, "read"> = {
    read: operationsRead,
  };
  const onboardingRead = vi.fn().mockResolvedValue(makeOnboardingSnapshot());
  const onboardingStore = {
    read: onboardingRead,
  } satisfies Pick<KapsoWhatsAppOnboardingSnapshot, never> & {
    read: (input: {
      access: "superadmin";
      actorIdentityId: string;
      clinicId: string;
    }) => Promise<KapsoWhatsAppOnboardingSnapshot>;
  };
  const evidenceRead = vi.fn().mockResolvedValue(persistedEvidence);
  const evidenceRecord = vi.fn(
    async (input: Parameters<WhatsAppActivationEvidenceStore["record"]>[0]) => {
      persistedEvidence.push({
        criterionCode: input.criterionCode,
        evidenceReference: input.evidenceReference,
        pendingReason: input.pendingReason,
        provisioningEventId: input.provisioningEventId,
        recordedAt: input.now,
        source: input.source,
      });
    },
  );
  const evidenceStore: WhatsAppActivationEvidenceStore = {
    read: evidenceRead,
    record: evidenceRecord,
  };
  return {
    evidenceRecord,
    evidenceRead,
    evidenceStore,
    onboardingRead,
    onboardingStore,
    operationsRead,
    operationsStore,
  };
}

describe("caso de uso del contrato de cierre de WhatsApp", () => {
  it("compone operaciones, onboarding y evidencia bajo el mismo contexto de Clínica", async () => {
    const dependencies = makeDependencies();

    const result = await getWhatsAppActivationContract(
      { actorIdentityId, clinicId, identityStatus: "authenticated" },
      dependencies,
    );

    expect(dependencies.operationsRead).toHaveBeenCalledWith({
      actorIdentityId,
      clinicId,
    });
    expect(dependencies.onboardingRead).toHaveBeenCalledWith({
      access: "superadmin",
      actorIdentityId,
      clinicId,
    });
    expect(dependencies.evidenceRead).toHaveBeenCalledWith({
      actorIdentityId,
      clinicId,
    });
    expect(result.states).toEqual({
      connection: "ready",
      identity: "authenticated",
      messaging: "synthetic-only",
      ownerAccess: "ready",
      technicalReadiness: "ready",
    });
  });

  it("propaga una Identidad bloqueada sin confundirla con el acceso del propietario", async () => {
    const dependencies = makeDependencies();

    const result = await getWhatsAppActivationContract(
      { actorIdentityId, clinicId, identityStatus: "blocked" },
      dependencies,
    );

    expect(result.states).toMatchObject({
      identity: "blocked",
      ownerAccess: "ready",
    });
    expect(result.closureStatus).toBe("blocked");
  });

  it("persiste la evidencia externa y la refleja en la matriz recalculada", async () => {
    const dependencies = makeDependencies();

    const result = await recordWhatsAppActivationEvidence(
      {
        actorIdentityId,
        clinicId,
        criterionCode: "technical-readiness",
        evidenceReference: "kapso-run-apo-94",
        now,
        pendingReason: null,
        source: "kapso",
        identityStatus: "authenticated",
      },
      dependencies,
    );

    expect(dependencies.evidenceRecord).toHaveBeenCalledWith({
      actorIdentityId,
      clinicId,
      criterionCode: "technical-readiness",
      evidenceReference: "kapso-run-apo-94",
      now,
      pendingReason: null,
      provisioningEventId: "generation-94",
      source: "kapso",
    });
    expect(
      result.criteria.find(
        (criterion) => criterion.code === "technical-readiness",
      )?.evidence.kapso?.evidenceReference,
    ).toBe("kapso-run-apo-94");
    expect(result.gatesRemainEnforced).toBe(true);
  });

  it("rechaza registrar evidencia para un criterio sin fuente externa requerida", async () => {
    const dependencies = makeDependencies();

    await expect(
      recordWhatsAppActivationEvidence(
        {
          actorIdentityId,
          clinicId,
          criterionCode: "scope-v1",
          evidenceReference: "decision-94",
          now,
          pendingReason: null,
          source: "deployed",
          identityStatus: "authenticated",
        },
        dependencies,
      ),
    ).rejects.toThrow("no requiere evidencia");
    expect(dependencies.evidenceRecord).not.toHaveBeenCalled();
  });

  it("rechaza evidencia verificada cuando no hay una generación vigente", async () => {
    const dependencies = makeDependencies();
    dependencies.operationsRead.mockResolvedValue({
      ...makeOperationsSnapshot(),
      connection: null,
    });

    await expect(
      recordWhatsAppActivationEvidence(
        {
          actorIdentityId,
          clinicId,
          criterionCode: "technical-readiness",
          evidenceReference: "kapso-run-apo-94",
          now,
          pendingReason: null,
          source: "kapso",
          identityStatus: "authenticated",
        },
        dependencies,
      ),
    ).rejects.toThrow("generación vigente");
    expect(dependencies.evidenceRecord).not.toHaveBeenCalled();
  });
});
