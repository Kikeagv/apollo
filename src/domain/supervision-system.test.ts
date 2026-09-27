import { describe, expect, it } from "vitest";

import {
  buildSupervisionSystemOverview,
  type SupervisionSystemQueueSnapshot,
} from "./supervision-system";

const queues: SupervisionSystemQueueSnapshot = {
  schedulerConfigured: true,
  workers: {
    appointments: { pending: 3, processing: 0, attention: 1 },
    webhooks: { pending: 2, processing: 1, attention: 0 },
    inbound: { pending: 0, processing: 0, attention: 1 },
    provisioning: { pending: 0, processing: 0, attention: 0 },
    outbound: { pending: 0, processing: 0, attention: 0 },
  },
  globalProblems: [
    {
      id: "alert-1",
      clinicId: "clinic-1",
      clinicName: "Clínica Central",
      area: "Conexión",
      reason: "El webhook fue rechazado",
      nextAction: "Revisar la firma del webhook",
      createdAt: new Date("2026-09-20T12:00:00.000Z"),
    },
  ],
};

describe("estado de proveedores y workers de supervisión", () => {
  it("expone la configuración, la cola y los problemas en datos separados", () => {
    const result = buildSupervisionSystemOverview({
      runtime: {
        apiKey: "configured",
        configured: true,
        missing: [],
        provider: "kapso",
        webhookSecret: "configured",
      },
      queues,
    });

    expect(result.provider).toEqual({
      id: "kapso",
      configured: true,
      missing: [],
    });
    expect(result.workers[0]).toMatchObject({
      key: "webhooks",
      configuration: "ready",
      queue: { pending: 2, processing: 1, attention: 0 },
      status: "working",
    });
    expect(result.workers[1]).toMatchObject({
      key: "inbound",
      status: "attention",
    });
    expect(result.globalProblems).toEqual(queues.globalProblems);
  });

  it("no infiere que un worker esté vivo cuando falta el secreto del scheduler", () => {
    const result = buildSupervisionSystemOverview({
      runtime: {
        apiKey: "configured",
        configured: true,
        missing: [],
        provider: "kapso",
        webhookSecret: "configured",
      },
      queues: { ...queues, schedulerConfigured: false },
    });

    expect(
      result.workers.every((worker) => worker.configuration === "missing"),
    ).toBe(true);
    expect(result.workers[0]?.status).toBe("not-configured");
    expect(result.workers[0]?.queue.pending).toBe(2);
  });
});
