import { describe, expect, it, vi } from "vitest";

import {
  getClinicSupervisionSummary,
  type ClinicSupervisionBaseSnapshot,
  type ClinicSupervisionDashboardDependencies,
} from "./supervision-dashboard";

const actorIdentityId = "superadmin-109";
const clinicId = "00000000-0000-0000-0000-000000000109";

function baseSnapshot(
  overrides: Partial<ClinicSupervisionBaseSnapshot> = {},
): ClinicSupervisionBaseSnapshot {
  return {
    clinic: {
      id: clinicId,
      isSynthetic: false,
      name: "Clínica APO-109",
      subscriptionStatus: "active",
    },
    owner: {
      access: "ready",
      invitationCanRetry: false,
      invitationDelivery: "succeeded",
      name: "Dra. Central",
    },
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<ClinicSupervisionDashboardDependencies> = {},
): ClinicSupervisionDashboardDependencies {
  return {
    store: {
      readClinic: vi.fn().mockResolvedValue(baseSnapshot()),
    },
    readWhatsAppReadiness: vi.fn().mockResolvedValue({
      billing: {
        creditCents: 12500,
        creditReserveCents: 2500,
        kapsoMonthlyQuota: 500,
        kapsoQuotaConsumed: 120,
        kapsoQuotaInFlight: 2,
        kapsoQuotaReserved: 4,
      },
      connection: { status: "ready" },
      nextAction: null,
      readiness: {
        gates: [
          {
            action: "",
            code: "billing",
            message: "Billing está listo",
            status: "ready",
          },
        ],
        nextAction: null,
        status: "ready",
        statusReason: "Todos los gates técnicos están correctos",
      },
      technicalStatus: "ready",
    }),
    readWhatsAppOperations: vi.fn().mockResolvedValue({
      trafficEvaluation: { allowed: true, blockers: [] },
      trafficStatus: "enabled",
    }),
    readCircuitBreaker: vi.fn().mockResolvedValue({
      cause: null,
      nextAction: "La Conexión opera normalmente",
      reason: "Circuito cerrado",
      status: "closed",
    }),
    ...overrides,
  };
}

describe("caso de uso del resumen de supervisión", () => {
  it("combina el acceso del Médico propietario con los estados canónicos de WhatsApp", async () => {
    const result = await getClinicSupervisionSummary(
      { actorIdentityId, clinicId },
      dependencies(),
    );

    expect(result).toMatchObject({
      clinic: { id: clinicId, name: "Clínica APO-109" },
      ownerName: "Dra. Central",
      messagingMode: "enabled",
      states: [
        { key: "owner-access", status: "ready" },
        { key: "subscription", status: "ready" },
        { key: "whatsapp-connection", status: "ready" },
        { key: "messaging-capacity", status: "ready" },
      ],
      capacityMetrics: {
        creditCents: 12500,
        creditReserveCents: 2500,
        monthlyQuota: 500,
        quotaConsumed: 120,
        quotaReserved: 4,
        quotaInFlight: 2,
      },
    });
  });

  it("prefiere el motivo y la acción del circuito abierto sobre gates incompletos", async () => {
    const deps = dependencies({
      readWhatsAppReadiness: vi.fn().mockResolvedValue({
        billing: {
          creditCents: 0,
          creditReserveCents: 0,
          kapsoMonthlyQuota: 500,
          kapsoQuotaConsumed: 500,
          kapsoQuotaInFlight: 0,
          kapsoQuotaReserved: 0,
        },
        connection: { status: "ready" },
        nextAction: "Revisar la capacidad",
        readiness: {
          gates: [
            {
              action: "Agregar crédito",
              code: "billing",
              message: "No hay crédito disponible",
              status: "blocked",
            },
          ],
          nextAction: "Agregar crédito",
          status: "blocked",
          statusReason: "No hay crédito disponible",
        },
        technicalStatus: "blocked",
      }),
      readCircuitBreaker: vi.fn().mockResolvedValue({
        cause: "quota-exhausted",
        nextAction: "Aumentar la cuota de Kapso",
        reason: "La cuota mensual está agotada",
        status: "open",
      }),
    });

    const result = await getClinicSupervisionSummary(
      { actorIdentityId, clinicId },
      deps,
    );

    expect(result?.states[3]).toMatchObject({
      status: "blocked",
      cause: "La cuota mensual está agotada",
      nextAction: "Aumentar la cuota de Kapso",
      responsible: "Equipo de pagos",
    });
  });

  it("no intenta leer información operativa si la Clínica no existe", async () => {
    const readReadiness = vi.fn(async () => {
      throw new Error("No debe leer readiness");
    });
    const deps = dependencies({
      store: { readClinic: vi.fn().mockResolvedValue(null) },
      readWhatsAppReadiness: readReadiness,
    });

    await expect(
      getClinicSupervisionSummary({ actorIdentityId, clinicId }, deps),
    ).resolves.toBeNull();
    expect(readReadiness).not.toHaveBeenCalled();
  });
});
