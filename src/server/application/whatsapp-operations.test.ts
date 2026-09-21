import { describe, expect, it, vi } from "vitest";

import {
  authorizeWhatsAppOffboarding,
  enableWhatsAppRealTraffic,
  offboardWhatsAppConnection,
  recordWhatsAppTrafficGate,
  revertWhatsAppRealTraffic,
  runWhatsAppSyntheticSmoke,
  type WhatsAppOperationsOffboardingStep,
  type WhatsAppOperationsSnapshot,
  type WhatsAppOperationsStore,
} from "./whatsapp-operations";
import { whatsappRealTrafficGateCodes } from "~/domain/whatsapp-traffic";
import { whatsappSyntheticSmokeStepCodes } from "~/domain/whatsapp-smoke";
import { WhatsAppRealTrafficBlockedError } from "./whatsapp-provider";

const now = new Date("2026-09-13T12:00:00.000Z");

function makeSnapshot(
  overrides: Partial<WhatsAppOperationsSnapshot> = {},
): WhatsAppOperationsSnapshot {
  return {
    clinicId: "00000000-0000-0000-0000-000000000092",
    clinicIsSynthetic: false,
    clinicName: "Clínica piloto",
    circuitStatus: "closed",
    connection: {
      businessAccountId: "waba-92",
      connectionType: "coexistence",
      customer: "customer-92",
      phoneNumberE164: "+50370000092",
      phoneNumberId: "phone-92",
      phoneNumberWebhookId: "phone-webhook-92",
      provisioningEventId: "generation-92",
      projectId: "project-92",
      projectWebhookId: "project-webhook-92",
      provider: "kapso",
      status: "ready",
      updatedAt: now,
    },
    gates: Object.fromEntries(
      whatsappRealTrafficGateCodes.map((code) => [
        code,
        {
          evidenceReference: `evidence:${code}`,
          ready: true,
          recordedAt: now,
        },
      ]),
    ),
    latestSmoke: {
      blockers: [],
      evidence: "Smoke sintético completo",
      finishedAt: now,
      id: "smoke-92",
      provisioningEventId: "generation-92",
      providerTransportVerified: true,
      realPatientsEnabled: false,
      startedAt: now,
      status: "passed",
      steps: whatsappSyntheticSmokeStepCodes.map((code) => ({
        code,
        evidence: `synthetic:${code}`,
        message: null,
        passed: true,
      })),
      syntheticContact: true,
    },
    offboarding: null,
    offboardingAuthorization: {
      authorizedAt: now,
      authorizedByIdentityId: "owner-92",
    },
    setupLinks: [
      {
        customerId: "customer-92",
        id: "setup-link-92",
        kapsoSetupLinkId: "kapso-link-92",
        status: "active",
      },
    ],
    technicalReadiness: { blockers: [], status: "ready" },
    trafficStatus: "blocked",
    ...overrides,
  };
}

function makeStore(initial = makeSnapshot()) {
  let snapshot = structuredClone(initial);
  const smokeRuns: unknown[] = [];
  const offboardingSteps = new Map<
    string,
    WhatsAppOperationsOffboardingStep[]
  >();
  const offboardingGenerationByRunId = new Map<string, string | null>();
  const offboardingRunIdByGeneration = new Map<string, string>();
  const offboardingStatusByRunId = new Map<
    string,
    "completed" | "failed" | "running"
  >();
  const store: WhatsAppOperationsStore = {
    async read() {
      return snapshot;
    },
    async recordTrafficGate(input) {
      snapshot = {
        ...snapshot,
        gates: {
          ...snapshot.gates,
          [input.code]: {
            evidenceReference: input.evidenceReference,
            ready: input.ready,
            recordedAt: input.now,
          },
        },
      };
      return snapshot;
    },
    async saveSyntheticSmokeRun(input) {
      smokeRuns.push(input);
      snapshot = {
        ...snapshot,
        latestSmoke: {
          ...input.result,
          finishedAt: input.finishedAt,
          id: input.runId,
          provisioningEventId: input.provisioningEventId,
          startedAt: input.startedAt,
        },
      };
      return snapshot;
    },
    async authorizeOffboarding(input) {
      snapshot = {
        ...snapshot,
        offboardingAuthorization: {
          authorizedAt: input.now,
          authorizedByIdentityId: input.actorIdentityId,
        },
      };
      return snapshot.offboardingAuthorization!;
    },
    async enableRealTraffic(input) {
      snapshot = {
        ...snapshot,
        trafficStatus: "enabled",
        connection: snapshot.connection && {
          ...snapshot.connection,
          updatedAt: input.now,
        },
      };
      return snapshot;
    },
    async revertRealTraffic(input) {
      snapshot = {
        ...snapshot,
        circuitStatus: "open",
        trafficStatus: "blocked",
        connection: snapshot.connection && {
          ...snapshot.connection,
          updatedAt: input.now,
        },
      };
      return snapshot;
    },
    async startOffboarding(input) {
      if (snapshot.offboardingAuthorization === null) {
        throw new Error("La Clínica no autorizó retirar la Conexión");
      }
      const currentGeneration =
        snapshot.connection?.provisioningEventId ?? null;
      const generationKey = currentGeneration ?? "no-generation";
      const existingRunIdForGeneration =
        offboardingRunIdByGeneration.get(generationKey);
      const existingGeneration = offboardingGenerationByRunId.get(input.runId);
      if (
        existingGeneration !== undefined &&
        existingGeneration !== currentGeneration
      ) {
        throw new Error(
          "El runId de offboarding pertenece a otra generación de la Conexión",
        );
      }
      const runId = existingRunIdForGeneration ?? input.runId;
      const previous = offboardingGenerationByRunId.has(runId)
        ? (snapshot.offboarding?.steps ?? [])
        : snapshot.offboarding?.provisioningEventId === currentGeneration
          ? (snapshot.offboarding?.steps ?? [])
          : [];
      const alreadyRunning = offboardingStatusByRunId.get(runId) === "running";
      const alreadyDisconnected =
        snapshot.connection?.status === "disconnected";
      const alreadyTrafficOff = snapshot.trafficStatus === "offboarded";
      snapshot = {
        ...snapshot,
        trafficStatus: "offboarded",
        connection: snapshot.connection && {
          ...snapshot.connection,
          status: "disconnected",
          updatedAt: input.now,
        },
        setupLinks: [],
      };
      offboardingGenerationByRunId.set(runId, currentGeneration);
      offboardingRunIdByGeneration.set(generationKey, runId);
      offboardingStatusByRunId.set(runId, "running");
      offboardingSteps.set(runId, []);
      return {
        alreadyRunning,
        alreadyDisconnected,
        alreadyTrafficOff,
        phoneNumberId: initial.connection?.phoneNumberId ?? null,
        phoneNumberWebhookId: initial.connection?.phoneNumberWebhookId ?? null,
        previousSteps: previous,
        provisioningEventId: currentGeneration,
        projectWebhookId: initial.connection?.projectWebhookId ?? null,
        runId,
        setupLinks: alreadyTrafficOff ? [] : initial.setupLinks,
        allowedConfiguration: {
          clinicId: snapshot.clinicId,
          assets: "preserved",
        },
      };
    },
    async recordOffboardingStep(input) {
      const steps = offboardingSteps.get(input.runId) ?? [];
      steps.push(input.step);
      offboardingSteps.set(input.runId, steps);
    },
    async markSetupLinkRevoked(input) {
      void input;
    },
    async finishOffboarding(input) {
      const steps = offboardingSteps.get(input.runId) ?? [];
      offboardingStatusByRunId.set(input.runId, input.status);
      snapshot = {
        ...snapshot,
        offboarding: {
          configurationExport: input.configurationExport,
          provisioningEventId: snapshot.connection?.provisioningEventId ?? null,
          runId: input.runId,
          status: input.status,
          steps,
        },
      };
      return snapshot.offboarding!;
    },
  };
  return {
    setSnapshot: (
      update: (
        current: WhatsAppOperationsSnapshot,
      ) => WhatsAppOperationsSnapshot,
    ) => {
      snapshot = update(snapshot);
    },
    smokeRuns,
    store,
  };
}

describe("operaciones finales de WhatsApp", () => {
  it("no habilita tráfico cuando falta evidencia legal o el smoke falló", async () => {
    const { store } = makeStore({
      ...makeSnapshot(),
      gates: {
        ...makeSnapshot().gates,
        consent: { evidenceReference: null, ready: false, recordedAt: null },
        billing: { evidenceReference: null, ready: false, recordedAt: null },
      },
      latestSmoke: { ...makeSnapshot().latestSmoke!, status: "failed" },
    });

    const error = await enableWhatsAppRealTraffic(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        manualConfirmation: true,
        now,
      },
      { store },
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WhatsAppRealTrafficBlockedError);
    if (!(error instanceof WhatsAppRealTrafficBlockedError)) return;
    expect(error.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["consent", "billing", "smoke"]),
    );
  });

  it("persiste un smoke fallido sin crear pacientes y conserva los bloqueos pendientes", async () => {
    const { smokeRuns, store } = makeStore();
    const runner = {
      run: vi.fn().mockResolvedValue({
        evidence: "Kapso synthetic smoke",
        realPatientsEnabled: false,
        steps: Object.fromEntries(
          whatsappSyntheticSmokeStepCodes.map((code) => [
            code,
            { evidence: `synthetic:${code}`, passed: code !== "sandbox" },
          ]),
        ),
        syntheticContact: true,
      }),
    };

    const failed = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
      },
      { idGenerator: () => "smoke-failed-92", runner, store },
    );
    expect(failed.status).toBe("failed");
    expect(failed.providerTransportVerified).toBe(false);
    expect(failed.realPatientsEnabled).toBe(false);
    expect(failed.steps.find((step) => step.code === "sandbox")?.passed).toBe(
      false,
    );
    expect(failed.blockers.map((blocker) => blocker.code)).toContain("sandbox");
    expect(
      failed.steps.find((step) => step.code === "adult-flow")?.passed,
    ).toBe(true);
    expect(smokeRuns).toHaveLength(1);

    runner.run.mockResolvedValueOnce({
      evidence: "Kapso synthetic smoke passed",
      realPatientsEnabled: false,
      steps: Object.fromEntries(
        whatsappSyntheticSmokeStepCodes.map((code) => [
          code,
          { evidence: `synthetic:${code}`, passed: true },
        ]),
      ),
      syntheticContact: true,
    });
    const passed = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
      },
      { idGenerator: () => "smoke-passed-92", runner, store },
    );
    expect(passed.status).toBe("failed");
    expect(passed.blockers.map((blocker) => blocker.code)).toContain(
      "provider-transport-unverified",
    );
    expect(
      passed.steps.find((step) => step.code === "guardian-pending")?.passed,
    ).toBe(true);
  });

  it("no habilita un smoke Kapso basado solo en contratos locales", async () => {
    const { store } = makeStore();
    const runner = {
      run: vi.fn().mockResolvedValue({
        evidence: "Contratos locales de transporte",
        realPatientsEnabled: false,
        steps: Object.fromEntries(
          whatsappSyntheticSmokeStepCodes.map((code) => [
            code,
            { evidence: `local:${code}`, passed: true },
          ]),
        ),
        syntheticContact: true,
      }),
    };

    const result = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
      },
      { idGenerator: () => "smoke-local-only-92", runner, store },
    );

    expect(result.status).toBe("failed");
    expect(result.blockers).toContainEqual({
      code: "provider-transport-unverified",
      message:
        "Kapso solo confirmó el webhook de prueba; el transporte externo completo todavía no está verificado",
    });
  });

  it("habilita tráfico cuando el smoke y los gates están completos", async () => {
    const { store } = makeStore();
    const enabled = await enableWhatsAppRealTraffic(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        manualConfirmation: true,
        now,
      },
      { store },
    );
    expect(enabled.trafficStatus).toBe("enabled");
  });

  it("marca como obsoleto un smoke si la Conexión cambia de generación durante la ejecución", async () => {
    const initial = makeSnapshot();
    const changed = makeSnapshot({
      connection: {
        ...initial.connection!,
        provisioningEventId: "generation-new-92",
      },
    });
    const { smokeRuns, store } = makeStore(initial);
    vi.spyOn(store, "read")
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(changed);
    const runner = {
      run: vi.fn().mockResolvedValue({
        realPatientsEnabled: false,
        steps: Object.fromEntries(
          whatsappSyntheticSmokeStepCodes.map((code) => [
            code,
            { evidence: `synthetic:${code}`, passed: true },
          ]),
        ),
        syntheticContact: true,
      }),
    };

    const result = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: initial.clinicId,
        now,
      },
      { runner, store },
    );

    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "smoke-generation-stale",
    );
    expect(result.status).toBe("failed");
    expect(smokeRuns[0]).toMatchObject({ provisioningEventId: null });
  });

  it("ejecuta el smoke simulado aunque no existan IDs remotos", async () => {
    const snapshot = makeSnapshot({
      clinicIsSynthetic: true,
      connection: {
        ...makeSnapshot().connection!,
        connectionType: "simulated",
        phoneNumberId: null,
        projectWebhookId: null,
        provider: "simulated",
      },
    });
    const { store } = makeStore(snapshot);
    const runner = {
      run: vi.fn().mockResolvedValue({
        realPatientsEnabled: false,
        steps: Object.fromEntries(
          whatsappSyntheticSmokeStepCodes.map((code) => [
            code,
            { evidence: `simulated:${code}`, passed: true },
          ]),
        ),
        syntheticContact: true,
      }),
    };

    const result = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: snapshot.clinicId,
        now,
      },
      { runner, store },
    );

    expect(result.status).toBe("passed");
    expect(
      result.steps.find((step) => step.code === "adult-flow")?.passed,
    ).toBe(true);
    expect(
      result.steps.find((step) => step.code === "guardian-pending")?.passed,
    ).toBe(true);
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: `simulated-phone:${snapshot.clinicId}`,
        projectWebhookId: `simulated-project:${snapshot.clinicId}`,
      }),
    );
  });

  it("no ejecuta un smoke sobre una Conexión retirada", async () => {
    const snapshot = makeSnapshot({
      connection: {
        ...makeSnapshot().connection!,
        status: "disconnected",
      },
      trafficStatus: "offboarded",
    });
    const { store } = makeStore(snapshot);
    const runner = { run: vi.fn() };

    const result = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: snapshot.clinicId,
        now,
      },
      { runner, store },
    );

    expect(result.status).toBe("failed");
    expect(result.blockers[0]?.code).toBe("runner");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("revierte tráfico de forma explícita abriendo el circuit breaker", async () => {
    const { store } = makeStore({
      ...makeSnapshot(),
      trafficStatus: "enabled",
    });

    const result = await revertWhatsAppRealTraffic(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        manualConfirmation: true,
        now,
        reason: "Revisión legal",
      },
      { store },
    );

    expect(result.trafficStatus).toBe("blocked");
    expect(result.circuitStatus).toBe("open");
  });

  it("hace offboarding idempotente y no repite revocaciones ya evidenciadas", async () => {
    const { store } = makeStore();
    const disableWebhook = vi.fn().mockResolvedValue({
      alreadyDisabled: false,
      evidence: "Kapso webhook active=false",
    });
    const revokeSetupLink = vi.fn().mockResolvedValue({});

    const dependencies = {
      provider: { disableWebhook },
      setupLinkProvider: { revokeSetupLink },
      store,
    };
    const first = await offboardWhatsAppConnection(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
      },
      dependencies,
    );
    const remoteCallsAfterFirst = disableWebhook.mock.calls.length;
    const second = await offboardWhatsAppConnection(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
      },
      dependencies,
    );

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(second.runId).toBe(first.runId);
    expect(remoteCallsAfterFirst).toBe(2);
    expect(disableWebhook).toHaveBeenCalledTimes(remoteCallsAfterFirst);
    expect(disableWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "phone-number",
        phoneNumberId: "phone-92",
      }),
    );
    expect(revokeSetupLink).toHaveBeenCalledTimes(1);
    expect(first.assetsPreserved).toBe(true);
  });

  it("rechaza un segundo offboarding mientras la generación sigue en curso", async () => {
    const { store } = makeStore();
    let releaseFirstWebhook!: () => void;
    const firstWebhook = new Promise<{ evidence: string }>((resolve) => {
      releaseFirstWebhook = () =>
        resolve({ evidence: "Kapso webhook active=false" });
    });
    const disableWebhook = vi
      .fn()
      .mockImplementationOnce(() => firstWebhook)
      .mockResolvedValue({
        alreadyDisabled: false,
        evidence: "Kapso webhook active=false",
      });
    const dependencies = {
      provider: { disableWebhook },
      setupLinkProvider: { revokeSetupLink: vi.fn() },
      store,
    };

    const first = offboardWhatsAppConnection(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
      },
      dependencies,
    );
    await vi.waitFor(() => expect(disableWebhook).toHaveBeenCalledTimes(1));

    await expect(
      offboardWhatsAppConnection(
        {
          actorIdentityId: "superadmin-92",
          clinicId: makeSnapshot().clinicId,
          now,
        },
        dependencies,
      ),
    ).rejects.toThrow("ya está en progreso");
    expect(disableWebhook).toHaveBeenCalledTimes(1);

    releaseFirstWebhook();
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });

  it("rechaza reutilizar un runId de offboarding después de reconectar otra generación", async () => {
    const { setSnapshot, store } = makeStore();
    const runId = "offboarding-run-92";
    const dependencies = {
      provider: { disableWebhook: vi.fn() },
      setupLinkProvider: { revokeSetupLink: vi.fn() },
      store,
    };

    await offboardWhatsAppConnection(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
        runId,
      },
      dependencies,
    );
    setSnapshot((current) => ({
      ...current,
      connection: current.connection && {
        ...current.connection,
        provisioningEventId: "generation-new-92",
        status: "ready",
      },
    }));

    await expect(
      offboardWhatsAppConnection(
        {
          actorIdentityId: "superadmin-92",
          clinicId: makeSnapshot().clinicId,
          now,
          runId,
        },
        dependencies,
      ),
    ).rejects.toThrow("pertenece a otra generación");
  });

  it("permite registrar explícitamente el estado de cada gate", async () => {
    const { store } = makeStore();
    const result = await recordWhatsAppTrafficGate(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        code: "dpa",
        evidenceReference: "dpa-2026-09",
        ready: true,
        now,
      },
      store,
    );

    expect(result.gates.dpa).toMatchObject({
      ready: true,
      evidenceReference: "dpa-2026-09",
    });
  });

  it("requiere confirmación explícita del propietario para autorizar el offboarding", async () => {
    const { store } = makeStore();

    await expect(
      authorizeWhatsAppOffboarding(
        {
          actorIdentityId: "owner-92",
          clinicId: makeSnapshot().clinicId,
          manualConfirmation: false,
          now,
        },
        store,
      ),
    ).rejects.toThrow("confirmación explícita");

    await expect(
      authorizeWhatsAppOffboarding(
        {
          actorIdentityId: "owner-92",
          clinicId: makeSnapshot().clinicId,
          manualConfirmation: true,
          now,
        },
        store,
      ),
    ).resolves.toMatchObject({ authorizedByIdentityId: "owner-92" });
  });

  it("no inicia offboarding sin autorización persistida de la Clínica", async () => {
    const { store } = makeStore({
      ...makeSnapshot(),
      offboardingAuthorization: null,
    });

    await expect(
      offboardWhatsAppConnection(
        {
          actorIdentityId: "superadmin-92",
          clinicId: makeSnapshot().clinicId,
          now,
        },
        {
          provider: { disableWebhook: vi.fn() },
          setupLinkProvider: { revokeSetupLink: vi.fn() },
          store,
        },
      ),
    ).rejects.toThrow("no autorizó retirar");
  });
});
