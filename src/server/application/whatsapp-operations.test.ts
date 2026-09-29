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
        eventId: null,
        message: null,
        observedAt: null,
        passed: true,
        source: null,
        status: "passed",
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
  const offboardingLeaseByRunId = new Map<
    string,
    { expiresAt: Date; token: string }
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
    async resolveSyntheticSmokeContact() {
      return { id: "controlled-contact-92", maskedPhone: "+••••••0092" };
    },
    async createWhatsAppTestContact(input) {
      return {
        id: "created-contact-92",
        maskedPhone: "+••••••0092",
        name: input.name,
        phoneE164: input.phoneE164,
      };
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
      const previous =
        offboardingSteps.get(runId) ??
        (snapshot.offboarding?.provisioningEventId === currentGeneration
          ? (snapshot.offboarding?.steps ?? [])
          : []);
      const alreadyCompleted =
        offboardingStatusByRunId.get(runId) === "completed";
      const currentLease = offboardingLeaseByRunId.get(runId);
      const alreadyRunning =
        offboardingStatusByRunId.get(runId) === "running" &&
        currentLease !== undefined &&
        currentLease.expiresAt > input.now;
      const alreadyDisconnected =
        snapshot.connection?.status === "disconnected";
      const alreadyTrafficOff = snapshot.trafficStatus === "offboarded";
      if (!alreadyRunning && !alreadyCompleted) {
        offboardingLeaseByRunId.set(runId, {
          expiresAt: new Date(input.now.valueOf() + 120_000),
          token: input.leaseToken,
        });
        offboardingStatusByRunId.set(runId, "running");
      }
      if (!offboardingGenerationByRunId.has(runId)) {
        offboardingSteps.set(runId, []);
      }
      if (!alreadyCompleted) {
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
      }
      offboardingGenerationByRunId.set(runId, currentGeneration);
      offboardingRunIdByGeneration.set(generationKey, runId);
      return {
        alreadyCompleted,
        alreadyRunning,
        alreadyDisconnected,
        alreadyTrafficOff,
        cancelledPendingDeliveries: 0,
        leaseToken: alreadyRunning
          ? (currentLease?.token ?? input.leaseToken)
          : input.leaseToken,
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
      offboardingLeaseByRunId.set(input.runId, {
        expiresAt: new Date(input.now.valueOf() + 120_000),
        token: input.leaseToken,
      });
    },
    async markSetupLinkRevoked(input) {
      offboardingLeaseByRunId.set(input.runId, {
        expiresAt: new Date(input.now.valueOf() + 120_000),
        token: input.leaseToken,
      });
      snapshot = {
        ...snapshot,
        setupLinks: snapshot.setupLinks.filter(
          (link) => link.id !== input.setupLinkId,
        ),
      };
    },
    async finishOffboarding(input) {
      const steps = offboardingSteps.get(input.runId) ?? [];
      offboardingStatusByRunId.set(input.runId, input.status);
      offboardingLeaseByRunId.delete(input.runId);
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
        testContactPhoneE164: "+50370000092",
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
        testContactPhoneE164: "+50370000092",
      },
      { idGenerator: () => "smoke-passed-92", runner, store },
    );
    expect(passed.status).toBe("pending");
    expect(passed.providerTransportVerified).toBe(false);
    expect(
      passed.steps.find((step) => step.code === "guardian-pending")?.passed,
    ).toBe(true);
  });

  it("mantiene pendiente un smoke Kapso basado solo en contratos locales", async () => {
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
        testContactPhoneE164: "+50370000092",
      },
      { idGenerator: () => "smoke-local-only-92", runner, store },
    );

    expect(result.status).toBe("pending");
    expect(result.providerTransportVerified).toBe(false);
  });

  it("no interpreta evidencia local como preflight del webhook Kapso", async () => {
    const { store } = makeStore();
    const runner = {
      run: vi.fn().mockResolvedValue({
        evidence: "Solo contratos locales",
        realPatientsEnabled: false,
        steps: Object.fromEntries(
          whatsappSyntheticSmokeStepCodes
            .filter((code) => code !== "webhook-preflight")
            .map((code) => [code, { evidence: `local:${code}`, passed: true }]),
        ),
        syntheticContact: true,
      }),
    };

    const result = await runWhatsAppSyntheticSmoke(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        now,
        testContactPhoneE164: "+50370000092",
      },
      { runner, store },
    );

    expect(result.status).toBe("failed");
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "webhook-preflight",
    );
  });

  it("requiere un Contacto de prueba registrado para ejecutar el roundtrip Kapso", async () => {
    const { store } = makeStore();
    const runner = { run: vi.fn() };

    await expect(
      runWhatsAppSyntheticSmoke(
        {
          actorIdentityId: "superadmin-92",
          clinicId: makeSnapshot().clinicId,
          now,
        },
        { runner, store },
      ),
    ).rejects.toThrow(/E\.164 de un Contacto de prueba/i);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("inicia un E2E real pendiente con Contacto controlado y timeout por Clínica", async () => {
    const { smokeRuns, store } = makeStore();
    const runner = {
      run: vi.fn().mockResolvedValue({
        evidence: "Preflight del webhook de proyecto confirmado",
        providerTransportVerified: false,
        realPatientsEnabled: false,
        steps: Object.fromEntries(
          whatsappSyntheticSmokeStepCodes.map((code) => [
            code,
            {
              evidence: `provider:${code}`,
              eventId: `event:${code}`,
              observedAt: now,
              passed: true,
              source: "provider",
              status: "passed",
            },
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
        testContactPhoneE164: "+50370000092",
      },
      {
        idGenerator: () => "a268e988-cddc-47c8-8b7a-a40da1060016",
        runner,
        store,
      },
    );

    expect(result).toMatchObject({
      id: "a268e988-cddc-47c8-8b7a-a40da1060016",
      providerTransportVerified: false,
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      status: "pending",
      testContactId: "controlled-contact-92",
      testContactMaskedPhone: "+••••••0092",
      timeoutAt: new Date(now.valueOf() + 5 * 60_000),
    });
    expect(result.finishedAt).toBeNull();
    expect(
      result.steps.find((step) => step.code === "real-reception"),
    ).toMatchObject({ status: "pending", passed: false });
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        syntheticContactId: "synthetic-smoke:controlled-contact-92",
      }),
    );
    expect(smokeRuns).toHaveLength(1);
    expect(smokeRuns[0]).toMatchObject({
      runId: "a268e988-cddc-47c8-8b7a-a40da1060016",
      result: {
        status: "pending",
        realPatientsEnabled: false,
        testContactId: "controlled-contact-92",
      },
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
        testContactPhoneE164: "+50370000092",
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
        testContactPhoneE164: "+50370000092",
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
        manualConfirmation: true,
        now,
      },
      dependencies,
    );
    const remoteCallsAfterFirst = disableWebhook.mock.calls.length;
    const second = await offboardWhatsAppConnection(
      {
        actorIdentityId: "superadmin-92",
        clinicId: makeSnapshot().clinicId,
        manualConfirmation: true,
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

  it("no repite pasos completados al reanudar un offboarding interrumpido", async () => {
    const { store } = makeStore();
    const startOffboarding = store.startOffboarding.bind(store);
    store.startOffboarding = async (input) => ({
      ...(await startOffboarding(input)),
      alreadyRunning: false,
      alreadyCompleted: false,
      cancelledPendingDeliveries: 2,
      previousSteps: [
        {
          code: "stop-sends",
          effect: "changed",
          evidence: "Conexión desconectada; 2 Entregas pendientes canceladas",
          message: "Envíos detenidos; 2 Entregas pendientes canceladas",
          status: "succeeded",
        },
        {
          code: "disconnect-connection",
          effect: "changed",
          evidence: "status=disconnected",
          message: "Conexión marcada como disconnected",
          status: "succeeded",
        },
        {
          code: "disable-project-webhook",
          effect: "changed",
          evidence: "Kapso webhook project active=false",
          message: "Webhook de Praxia desactivado",
          status: "succeeded",
        },
      ],
      setupLinks: makeSnapshot().setupLinks,
    });
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

    await expect(
      offboardWhatsAppConnection(
        {
          actorIdentityId: "superadmin-92",
          clinicId: makeSnapshot().clinicId,
          manualConfirmation: true,
          now,
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      cancelledPendingDeliveries: 2,
      status: "completed",
    });
    expect(disableWebhook).toHaveBeenCalledTimes(1);
    expect(disableWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "phone-number" }),
    );
    expect(revokeSetupLink).toHaveBeenCalledTimes(1);
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
        manualConfirmation: true,
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
          manualConfirmation: true,
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
          manualConfirmation: true,
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

  it("requires explicit confirmation before stopping WhatsApp operations", async () => {
    const { store } = makeStore();
    const startOffboarding = vi.spyOn(store, "startOffboarding");

    await expect(
      offboardWhatsAppConnection(
        {
          actorIdentityId: "superadmin-92",
          clinicId: makeSnapshot().clinicId,
          manualConfirmation: false,
          now,
        },
        {
          provider: { disableWebhook: vi.fn() },
          setupLinkProvider: { revokeSetupLink: vi.fn() },
          store,
        },
      ),
    ).rejects.toThrow("confirmación explícita");
    expect(startOffboarding).not.toHaveBeenCalled();
  });
});
