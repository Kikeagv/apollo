import { randomUUID } from "node:crypto";

import {
  evaluateWhatsAppSyntheticSmoke,
  sanitizeWhatsAppSyntheticSmokeResult,
  whatsappSyntheticSmokeProviderStepCodes,
  type WhatsAppSyntheticSmokeResult,
  type WhatsAppSyntheticSmokeStepCode,
  type WhatsAppSyntheticSmokeStepInput,
} from "~/domain/whatsapp-smoke";
import { isValidE164PhoneNumber } from "~/domain/whatsapp-preflight";
import {
  evaluateWhatsAppRealTraffic,
  type WhatsAppRealTrafficEvaluation,
  type WhatsAppRealTrafficGateCode,
  type WhatsAppRealTrafficGateInput,
} from "~/domain/whatsapp-traffic";
import {
  isWhatsAppOffboardingComplete,
  type WhatsAppOffboardingStep,
  type WhatsAppOffboardingStepCode,
} from "~/domain/whatsapp-offboarding";
import type { WhatsAppConnectionStatus } from "~/domain/whatsapp-connection";
import type { WhatsAppTechnicalReadinessStatus } from "~/domain/whatsapp-readiness";
import { WhatsAppRealTrafficBlockedError } from "./whatsapp-provider";
import { runPraxiaWhatsAppSyntheticSmoke } from "~/server/whatsapp/simulated-whatsapp-smoke";

export { WhatsAppRealTrafficBlockedError } from "./whatsapp-provider";

export type WhatsAppOperationsConnection = {
  businessAccountId: string | null;
  connectionType: "coexistence" | "simulated";
  customer: string;
  phoneNumberE164: string | null;
  phoneNumberId: string | null;
  phoneNumberWebhookId: string | null;
  provisioningEventId: string | null;
  projectId: string | null;
  projectWebhookId: string | null;
  provider: "kapso" | "simulated";
  status: WhatsAppConnectionStatus;
  updatedAt: Date;
};

export type WhatsAppOperationsSmokeRun = WhatsAppSyntheticSmokeResult & {
  finishedAt: Date | null;
  id: string;
  provisioningEventId: string | null;
  startedAt: Date;
};

export type WhatsAppOperationsOffboardingStep = WhatsAppOffboardingStep & {
  evidence: string | null;
  message: string;
};

export type WhatsAppOperationsSnapshot = {
  circuitStatus: "closed" | "open";
  clinicId: string;
  clinicIsSynthetic: boolean;
  clinicName: string;
  connection: WhatsAppOperationsConnection | null;
  gates: Partial<
    Record<
      WhatsAppRealTrafficGateCode,
      WhatsAppRealTrafficGateInput & { recordedAt: Date | null }
    >
  >;
  latestSmoke: WhatsAppOperationsSmokeRun | null;
  offboardingAuthorization: {
    authorizedAt: Date;
    authorizedByIdentityId: string;
  } | null;
  offboarding: {
    configurationExport: Record<string, unknown>;
    provisioningEventId: string | null;
    runId: string;
    status: "completed" | "failed" | "running";
    steps: WhatsAppOperationsOffboardingStep[];
  } | null;
  setupLinks: Array<{
    customerId: string;
    id: string;
    kapsoSetupLinkId: string;
    status: "active" | "expired" | "revoked" | "used";
  }>;
  technicalReadiness: {
    blockers: string[];
    status: WhatsAppTechnicalReadinessStatus;
  };
  trafficStatus: "blocked" | "enabled" | "offboarded";
};

export type WhatsAppOffboardingStart = {
  allowedConfiguration: Record<string, unknown>;
  alreadyRunning: boolean;
  alreadyDisconnected: boolean;
  alreadyTrafficOff: boolean;
  phoneNumberId: string | null;
  phoneNumberWebhookId: string | null;
  previousSteps: WhatsAppOperationsOffboardingStep[];
  provisioningEventId: string | null;
  projectWebhookId: string | null;
  runId: string;
  setupLinks: WhatsAppOperationsSnapshot["setupLinks"];
};

export type WhatsAppOperationsStore = {
  read(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<WhatsAppOperationsSnapshot>;
  recordTrafficGate(input: {
    actorIdentityId: string;
    clinicId: string;
    code: WhatsAppRealTrafficGateCode;
    evidenceReference: string | null;
    now: Date;
    ready: boolean;
  }): Promise<WhatsAppOperationsSnapshot>;
  saveSyntheticSmokeRun(input: {
    actorIdentityId: string;
    clinicId: string;
    finishedAt: Date | null;
    provisioningEventId: string | null;
    result: WhatsAppSyntheticSmokeResult;
    runId: string;
    startedAt: Date;
  }): Promise<WhatsAppOperationsSnapshot>;
  resolveSyntheticSmokeContact(input: {
    actorIdentityId: string;
    clinicId: string;
    phoneE164: string;
  }): Promise<{ id: string; maskedPhone: string }>;
  authorizeOffboarding(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
  }): Promise<{
    authorizedAt: Date;
    authorizedByIdentityId: string;
  }>;
  enableRealTraffic(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
  }): Promise<WhatsAppOperationsSnapshot>;
  revertRealTraffic(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
    reason: string;
  }): Promise<WhatsAppOperationsSnapshot>;
  startOffboarding(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
    runId: string;
  }): Promise<WhatsAppOffboardingStart>;
  recordOffboardingStep(input: {
    actorIdentityId: string;
    clinicId: string;
    runId: string;
    step: WhatsAppOperationsOffboardingStep;
  }): Promise<void>;
  markSetupLinkRevoked(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
    setupLinkId: string;
  }): Promise<void>;
  finishOffboarding(input: {
    actorIdentityId: string;
    clinicId: string;
    configurationExport: Record<string, unknown>;
    now: Date;
    runId: string;
    status: "completed" | "failed";
  }): Promise<NonNullable<WhatsAppOperationsSnapshot["offboarding"]>>;
};

export type WhatsAppSyntheticSmokeRunner = {
  run(input: {
    clinicId: string;
    phoneNumberId: string;
    projectWebhookId: string;
    syntheticContactId: string;
  }): Promise<WhatsAppSyntheticSmokeRunnerResult>;
};

export type WhatsAppSyntheticSmokeRunnerResult = {
  evidence?: string;
  /**
   * Solo es true cuando el runner del proveedor verificó el transporte remoto
   * completo. Los contratos locales nunca son suficientes para habilitar
   * tráfico real de una Conexión Kapso.
   */
  providerTransportVerified?: boolean;
  realPatientsEnabled: boolean;
  steps: Partial<
    Record<WhatsAppSyntheticSmokeStepCode, WhatsAppSyntheticSmokeStepInput>
  >;
  syntheticContact: boolean;
};

export type WhatsAppOffboardingWebhookProvider = {
  disableWebhook(input: {
    kind: "phone-number" | "project";
    phoneNumberId: string | null;
    remoteId: string;
  }): Promise<{ alreadyDisabled?: boolean; evidence: string }>;
};

export type WhatsAppOffboardingSetupLinkProvider = {
  revokeSetupLink(input: {
    customerId: string;
    setupLinkId: string;
  }): Promise<unknown>;
};

export async function getWhatsAppOperations(
  input: { actorIdentityId: string; clinicId: string },
  store: WhatsAppOperationsStore,
) {
  const snapshot = await store.read(input);
  return {
    ...snapshot,
    trafficEvaluation: evaluateWhatsAppOperationsTraffic(snapshot),
  };
}

export function evaluateWhatsAppOperationsTraffic(
  snapshot: WhatsAppOperationsSnapshot,
): WhatsAppRealTrafficEvaluation {
  return evaluateTraffic(snapshot);
}

export function recordWhatsAppTrafficGate(
  input: {
    actorIdentityId: string;
    clinicId: string;
    code: WhatsAppRealTrafficGateCode;
    evidenceReference: string | null;
    now?: Date;
    ready: boolean;
  },
  store: WhatsAppOperationsStore,
) {
  const evidenceReference = input.evidenceReference?.trim();
  return store.recordTrafficGate({
    ...input,
    evidenceReference:
      evidenceReference === undefined || evidenceReference === ""
        ? null
        : evidenceReference,
    now: input.now ?? new Date(),
  });
}

export async function authorizeWhatsAppOffboarding(
  input: {
    actorIdentityId: string;
    clinicId: string;
    manualConfirmation: boolean;
    now?: Date;
  },
  store: WhatsAppOperationsStore,
) {
  if (!input.manualConfirmation) {
    throw new Error(
      "Autorizar el offboarding requiere confirmación explícita del propietario",
    );
  }
  return store.authorizeOffboarding({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    now: input.now ?? new Date(),
  });
}

export async function runWhatsAppSyntheticSmoke(
  input: {
    actorIdentityId: string;
    clinicId: string;
    now?: Date;
    testContactPhoneE164?: string;
  },
  dependencies: {
    idGenerator?: () => string;
    runner: WhatsAppSyntheticSmokeRunner;
    store: WhatsAppOperationsStore;
  },
) {
  const startedAt = input.now ?? new Date();
  const runId = dependencies.idGenerator?.() ?? randomUUID();
  const snapshot = await dependencies.store.read(input);
  const isKapso = snapshot.connection?.provider === "kapso";
  const canStartKapsoSmoke =
    isKapso &&
    snapshot.trafficStatus !== "offboarded" &&
    snapshot.connection?.status !== "disconnected" &&
    snapshot.connection?.phoneNumberId !== null &&
    snapshot.connection?.projectWebhookId !== null;
  const testContact = canStartKapsoSmoke
    ? await resolveSmokeTestContact(input, dependencies.store)
    : null;
  const timeoutAt = isKapso ? new Date(startedAt.valueOf() + 5 * 60_000) : null;
  const syntheticContactId = testContact
    ? `synthetic-smoke:${testContact.id}`
    : `synthetic-smoke:${input.clinicId}`;
  const praxiaResult = await runPraxiaWhatsAppSyntheticSmoke({
    clinicId: input.clinicId,
    phoneNumberId:
      snapshot.connection?.phoneNumberId ??
      (snapshot.connection?.provider === "simulated"
        ? `simulated-phone:${input.clinicId}`
        : ""),
    projectWebhookId:
      snapshot.connection?.projectWebhookId ??
      (snapshot.connection?.provider === "simulated"
        ? `simulated-project:${input.clinicId}`
        : ""),
    syntheticContactId,
  });
  let rawResult: Awaited<ReturnType<WhatsAppSyntheticSmokeRunner["run"]>> =
    mergeSmokeRunnerResults(praxiaResult, {
      realPatientsEnabled: false,
      steps: {},
      syntheticContact: true,
    });
  let providerError: string | null = null;
  const isSimulated = snapshot.connection?.provider === "simulated";
  const phoneNumberId =
    snapshot.connection?.phoneNumberId ??
    (isSimulated ? `simulated-phone:${input.clinicId}` : null);
  const projectWebhookId =
    snapshot.connection?.projectWebhookId ??
    (isSimulated ? `simulated-project:${input.clinicId}` : null);
  if (
    snapshot.trafficStatus === "offboarded" ||
    snapshot.connection?.status === "disconnected"
  ) {
    providerError =
      "La Conexión está retirada; reconéctela antes de ejecutar el smoke";
  } else if (phoneNumberId === null || projectWebhookId === null) {
    providerError =
      "No hay evidencia suficiente de número y webhook para ejecutar el smoke";
  } else {
    try {
      rawResult = await dependencies.runner.run({
        clinicId: input.clinicId,
        phoneNumberId,
        projectWebhookId,
        syntheticContactId,
      });
      rawResult = mergeSmokeRunnerResults(praxiaResult, rawResult);
    } catch (error) {
      providerError = toErrorMessage(error);
    }
  }
  if (isKapso) {
    const preflight = rawResult.steps["webhook-preflight"];
    if (providerError !== null || preflight === undefined) {
      rawResult = {
        ...rawResult,
        steps: {
          ...rawResult.steps,
          "webhook-preflight": {
            evidence: null,
            message: providerError ?? "Kapso no confirmó el preflight",
            passed: false,
            source: "provider" as const,
            status: "failed" as const,
          },
        },
      };
    }
    rawResult = {
      ...rawResult,
      steps: {
        ...rawResult.steps,
        "real-reception": { passed: false, status: "pending" },
        "real-processing": { passed: false, status: "pending" },
        "real-response": { passed: false, status: "pending" },
        "real-delivery": { passed: false, status: "pending" },
      },
      syntheticContact: false,
    };
  }
  const result = evaluateWhatsAppSyntheticSmoke({
    ...rawResult,
    requireRealRoundtrip: isKapso,
    runId,
    testContactId: testContact?.id ?? null,
    testContactMaskedPhone: testContact?.maskedPhone ?? null,
    timeoutAt,
  });
  const completedSnapshot = await dependencies.store.read(input);
  const startedGeneration = snapshot.connection?.provisioningEventId ?? null;
  const completedGeneration =
    completedSnapshot.connection?.provisioningEventId ?? null;
  let persistedGeneration = startedGeneration;
  if (startedGeneration !== completedGeneration) {
    result.status = "failed";
    persistedGeneration = null;
    result.blockers.unshift({
      code: "smoke-generation-stale",
      message:
        "La Conexión cambió de generación mientras se ejecutaba el smoke",
    });
  }
  if (providerError !== null) {
    result.status = "failed";
    result.blockers.unshift({ code: "runner", message: providerError });
  }
  const safeResult = sanitizeWhatsAppSyntheticSmokeResult(result);
  const completedAt = new Date();
  const finishedAt = safeResult.status === "pending" ? null : completedAt;
  await dependencies.store.saveSyntheticSmokeRun({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    finishedAt,
    provisioningEventId: persistedGeneration,
    result: safeResult,
    runId,
    startedAt,
  });
  return { ...safeResult, finishedAt, id: runId, startedAt };
}

async function resolveSmokeTestContact(
  input: {
    actorIdentityId: string;
    clinicId: string;
    testContactPhoneE164?: string;
  },
  store: WhatsAppOperationsStore,
) {
  const phoneE164 = input.testContactPhoneE164?.trim();
  if (phoneE164 === undefined || !isValidE164PhoneNumber(phoneE164)) {
    throw new Error(
      "Indique el teléfono E.164 de un Contacto de prueba sin vínculo a Paciente",
    );
  }
  return store.resolveSyntheticSmokeContact({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    phoneE164,
  });
}

export async function enableWhatsAppRealTraffic(
  input: {
    actorIdentityId: string;
    clinicId: string;
    manualConfirmation: boolean;
    now?: Date;
  },
  dependencies: { store: WhatsAppOperationsStore },
) {
  if (!input.manualConfirmation) {
    throw new Error("Habilitar tráfico real requiere confirmación explícita");
  }
  const snapshot = await dependencies.store.read(input);
  const evaluation = evaluateWhatsAppOperationsTraffic(snapshot);
  if (!evaluation.allowed) {
    throw new WhatsAppRealTrafficBlockedError(evaluation.blockers);
  }
  return dependencies.store.enableRealTraffic({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    now: input.now ?? new Date(),
  });
}

export async function revertWhatsAppRealTraffic(
  input: {
    actorIdentityId: string;
    clinicId: string;
    manualConfirmation: boolean;
    now?: Date;
    reason: string;
  },
  dependencies: { store: WhatsAppOperationsStore },
) {
  if (!input.manualConfirmation) {
    throw new Error("Revertir tráfico real requiere confirmación explícita");
  }
  const now = input.now ?? new Date();
  const snapshot = await dependencies.store.read(input);
  if (snapshot.trafficStatus === "offboarded") {
    throw new Error(
      "La Conexión ya fue retirada y no puede revertirse desde este control",
    );
  }
  const reverted = await dependencies.store.revertRealTraffic({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    now,
    reason: input.reason.trim() || "Reversión manual del tráfico real",
  });
  return reverted;
}

export async function offboardWhatsAppConnection(
  input: {
    actorIdentityId: string;
    clinicId: string;
    now?: Date;
    runId?: string;
  },
  dependencies: {
    provider: WhatsAppOffboardingWebhookProvider;
    setupLinkProvider: WhatsAppOffboardingSetupLinkProvider;
    store: WhatsAppOperationsStore;
  },
) {
  const now = input.now ?? new Date();
  const requestedRunId = input.runId ?? randomUUID();
  const start = await dependencies.store.startOffboarding({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    now,
    runId: requestedRunId,
  });
  if (start.alreadyRunning) {
    throw new Error("El offboarding de esta generación ya está en progreso");
  }
  const runId = start.runId;
  const steps: WhatsAppOperationsOffboardingStep[] = [];
  const previous = new Map(
    start.previousSteps.map((step) => [step.code, step]),
  );

  const record = async (
    step: WhatsAppOperationsOffboardingStep,
  ): Promise<void> => {
    steps.push(step);
    await dependencies.store.recordOffboardingStep({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
      runId,
      step,
    });
  };

  await record({
    code: "stop-sends",
    effect: start.alreadyTrafficOff ? "already-complete" : "changed",
    evidence: "La Conexión quedó fuera de la cola de salida",
    message: "Envíos detenidos",
    status: "succeeded",
  });
  await record({
    code: "disconnect-connection",
    effect: start.alreadyDisconnected ? "already-complete" : "changed",
    evidence: "status=disconnected",
    message: "Conexión marcada como disconnected",
    status: "succeeded",
  });

  await disableWebhookStep({
    code: "disable-project-webhook",
    kind: "project",
    phoneNumberId: start.phoneNumberId,
    previous,
    record,
    remoteId: start.projectWebhookId,
    provider: dependencies.provider,
  });
  await disableWebhookStep({
    code: "disable-phone-webhook",
    kind: "phone-number",
    phoneNumberId: start.phoneNumberId,
    previous,
    record,
    remoteId: start.phoneNumberWebhookId,
    provider: dependencies.provider,
  });

  if (start.setupLinks.length === 0) {
    await record({
      code: "revoke-setup-links",
      effect: "already-complete",
      evidence: "No hay setup links activos de Praxia",
      message: "Setup links revocados o inexistentes",
      status: "succeeded",
    });
  } else {
    let failed = false;
    for (const setupLink of start.setupLinks) {
      try {
        await dependencies.setupLinkProvider.revokeSetupLink({
          customerId: setupLink.customerId,
          setupLinkId: setupLink.kapsoSetupLinkId,
        });
        await dependencies.store.markSetupLinkRevoked({
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          now,
          setupLinkId: setupLink.id,
        });
      } catch (error) {
        const message = toErrorMessage(error);
        failed = true;
        await record({
          code: "revoke-setup-links",
          effect: "changed",
          evidence: message,
          message,
          status: "failed",
        });
        break;
      }
    }
    if (!failed) {
      await record({
        code: "revoke-setup-links",
        effect: "changed",
        evidence: `Revocados ${start.setupLinks.length} setup link(s)`,
        message: "Setup links de Praxia revocados",
        status: "succeeded",
      });
    }
  }

  await record({
    code: "export-configuration",
    effect: "changed",
    evidence: "Exportación limitada a configuración permitida",
    message: "Configuración permitida exportada",
    status: "succeeded",
  });

  const status = isWhatsAppOffboardingComplete(
    steps.map(({ code, effect, status }) => ({ code, effect, status })),
  )
    ? "completed"
    : "failed";
  const result = await dependencies.store.finishOffboarding({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    configurationExport: start.allowedConfiguration,
    now,
    runId,
    status,
  });
  return {
    assetsPreserved: true as const,
    configurationExport: start.allowedConfiguration,
    runId,
    status,
    steps: result.steps,
  };
}

async function disableWebhookStep(input: {
  code: "disable-phone-webhook" | "disable-project-webhook";
  kind: "phone-number" | "project";
  phoneNumberId: string | null;
  previous: Map<WhatsAppOffboardingStepCode, WhatsAppOperationsOffboardingStep>;
  provider: WhatsAppOffboardingWebhookProvider;
  record: (step: WhatsAppOperationsOffboardingStep) => Promise<void>;
  remoteId: string | null;
}) {
  const previous = input.previous.get(input.code);
  if (previous?.status === "succeeded" || input.remoteId === null) {
    await input.record({
      code: input.code,
      effect: "already-complete",
      evidence:
        input.remoteId === null
          ? "No existe webhook remoto registrado"
          : (previous?.evidence ?? null),
      message: "Webhook desactivado o inexistente",
      status: "succeeded",
    });
    return;
  }
  try {
    const result = await input.provider.disableWebhook({
      kind: input.kind,
      phoneNumberId: input.phoneNumberId,
      remoteId: input.remoteId,
    });
    await input.record({
      code: input.code,
      effect: result.alreadyDisabled === true ? "already-complete" : "changed",
      evidence: result.evidence,
      message: "Webhook de Praxia desactivado",
      status: "succeeded",
    });
  } catch (error) {
    const message = toErrorMessage(error);
    await input.record({
      code: input.code,
      effect: "changed",
      evidence: message,
      message,
      status: "failed",
    });
  }
}

function mergeSmokeRunnerResults(
  application: WhatsAppSyntheticSmokeRunnerResult,
  provider: WhatsAppSyntheticSmokeRunnerResult,
): WhatsAppSyntheticSmokeRunnerResult {
  const steps = { ...application.steps };
  for (const code of whatsappSyntheticSmokeProviderStepCodes) {
    const providerStep = provider.steps[code];
    if (providerStep === undefined) {
      delete steps[code];
    } else {
      steps[code] = providerStep;
    }
  }

  return {
    evidence: [application.evidence, provider.evidence]
      .filter((value): value is string => value !== undefined && value !== "")
      .join("; "),
    providerTransportVerified: provider.providerTransportVerified === true,
    realPatientsEnabled:
      application.realPatientsEnabled || provider.realPatientsEnabled,
    // Praxia conserva la autoridad de sus flujos de aplicación; los códigos
    // de transporte solo provienen del runner del proveedor y no se rellenan
    // con contratos locales si ese runner no los evidencia.
    steps,
    syntheticContact: application.syntheticContact && provider.syntheticContact,
  };
}

function evaluateTraffic(
  snapshot: WhatsAppOperationsSnapshot,
): WhatsAppRealTrafficEvaluation {
  return evaluateWhatsAppRealTraffic({
    circuitStatus: snapshot.circuitStatus,
    clinicIsSynthetic: snapshot.clinicIsSynthetic,
    connectionGenerationId: snapshot.connection?.provisioningEventId,
    connectionProvider: snapshot.connection?.provider,
    connectionStatus: snapshot.connection?.status ?? null,
    gates: snapshot.gates,
    smoke: snapshot.latestSmoke ?? {
      controlledTestContact: false,
      providerTransportVerified: false,
      realPatientsEnabled: false,
      provisioningEventId: null,
      status: "pending",
      syntheticContact: false,
    },
    technicalBlockers: snapshot.technicalReadiness.blockers,
    technicalReadiness: snapshot.technicalReadiness.status,
    trafficStatus: snapshot.trafficStatus,
  });
}

function toErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Operación de WhatsApp fallida";
}
