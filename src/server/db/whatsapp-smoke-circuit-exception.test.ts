import { describe, expect, it, vi } from "vitest";

import type { WhatsAppInboundMessage } from "~/domain/whatsapp-inbound";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import {
  isActiveControlledSmokeChallenge,
  isActiveControlledSmokeReply,
} from "~/server/db/whatsapp-smoke-circuit-exception";
import type { whatsappConnections } from "~/server/db/schema";

const now = new Date("2026-10-01T20:00:00.000Z");
const clinicId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const provisioningEventId = "00000000-0000-4000-8000-000000000003";
const testContactId = "00000000-0000-4000-8000-000000000004";

describe("excepción de roundtrip controlado con circuit breaker abierto", () => {
  it("acepta el reto exacto de la ejecución aunque falte aprobar plantillas", async () => {
    const transaction = createTransaction();
    const message = {
      connectionReference: "phone-1",
      customerReference: "customer-1",
      phoneE164: "+50370000001",
      text: `PRUEBA WHATSAPP ${runId}`,
    } as Pick<
      WhatsAppInboundMessage,
      "connectionReference" | "customerReference" | "phoneE164" | "text"
    >;

    await expect(
      isActiveControlledSmokeChallenge(transaction, {
        connection: createConnection(),
        message,
        now,
      }),
    ).resolves.toBe(true);
  });

  it("acepta el reto activo aunque difieran las razones de Conexión y circuito", async () => {
    const transaction = createTransaction();
    const message = {
      connectionReference: "phone-1",
      customerReference: "customer-1",
      phoneE164: "+50370000001",
      text: `PRUEBA WHATSAPP ${runId}`,
    } as Pick<
      WhatsAppInboundMessage,
      "connectionReference" | "customerReference" | "phoneE164" | "text"
    >;

    await expect(
      isActiveControlledSmokeChallenge(transaction, {
        connection: createConnection("Todos los gates técnicos están correctos"),
        message,
        now,
      }),
    ).resolves.toBe(true);
  });

  it("rechaza la excepción si la Conexión está bloqueada y el circuito está cerrado", async () => {
    const transaction = createTransaction({ circuitStatus: "closed" });
    const message = {
      connectionReference: "phone-1",
      customerReference: "customer-1",
      phoneE164: "+50370000001",
      text: `PRUEBA WHATSAPP ${runId}`,
    } as Pick<
      WhatsAppInboundMessage,
      "connectionReference" | "customerReference" | "phoneE164" | "text"
    >;

    await expect(
      isActiveControlledSmokeChallenge(transaction, {
        connection: createConnection(),
        message,
        now,
      }),
    ).resolves.toBe(false);
  });

  it("rechaza el reto si la salud de Kapso quedó antigua", async () => {
    const transaction = createTransaction({
      numberHealthCheckedAt: new Date(now.valueOf() - 16 * 60_000),
    });
    const message = {
      connectionReference: "phone-1",
      customerReference: "customer-1",
      phoneE164: "+50370000001",
      text: `PRUEBA WHATSAPP ${runId}`,
    } as Pick<
      WhatsAppInboundMessage,
      "connectionReference" | "customerReference" | "phoneE164" | "text"
    >;

    await expect(
      isActiveControlledSmokeChallenge(transaction, {
        connection: createConnection(),
        message,
        now,
      }),
    ).resolves.toBe(false);
  });

  it("permite solo la respuesta de la misma ejecución después de procesar el reto", async () => {
    const transaction = createTransaction({
      steps: [
        { code: "real-reception", passed: true, status: "passed" },
        { code: "real-processing", passed: true, status: "passed" },
        { code: "real-response", passed: false, status: "pending" },
        { code: "real-delivery", passed: false, status: "pending" },
      ],
    });

    await expect(
      isActiveControlledSmokeReply(transaction, {
        clinicId,
        connection: createConnection(),
        idempotencyKey: `whatsapp-smoke:${runId}:reply`,
        now,
        recipientPhoneE164: "+50370000001",
      }),
    ).resolves.toBe(true);
  });
});

function createConnection(statusReason = "high-failure-rate") {
  return {
    clinicId,
    businessAccountId: "waba-1",
    metadata: {
      health: "healthy",
      projectId: "project-1",
      provisioningEventId,
      statusReason,
      webhookStatus: "ready",
    },
    phoneNumberId: "phone-1",
    provider: "kapso",
    realTrafficStatus: "blocked",
    status: "blocked",
    customer: "customer-1",
  } as unknown as typeof whatsappConnections.$inferSelect;
}

function createTransaction(
  input: {
    numberHealthCheckedAt?: Date | null;
    circuitStatus?: "closed" | "open";
    steps?: Array<{
      code: string;
      passed: boolean;
      status: "passed" | "pending";
    }>;
  } = {},
) {
  const run = {
    id: runId,
    clinicId,
    provisioningEventId,
    requiresRealRoundtrip: true,
    realPatientsEnabled: false,
    status: "pending",
    syntheticContact: false,
    testContactId,
    timeoutAt: new Date(now.valueOf() + 5 * 60_000),
    steps:
      input.steps ??
      [
        "real-reception",
        "real-processing",
        "real-response",
        "real-delivery",
      ].map((code) => ({ code, passed: false, status: "pending" as const })),
  };
  const readiness = {
    businessAccountId: "waba-1",
    numberEnvironment: "production",
    numberHealth: "healthy",
    numberHealthCheckedAt: input.numberHealthCheckedAt ?? now,
    phoneNumberId: "phone-1",
    phoneNumberWebhookId: "phone-webhook-1",
    phoneNumberWebhookStatus: "ready",
    projectId: "project-1",
    projectWebhookId: "project-webhook-1",
    projectWebhookStatus: "ready",
    provisioningEventId,
    // The global readiness is blocked by unapproved templates. Step 3 must
    // still be available before templates have been approved.
    technicalStatus: "blocked",
    statusReason: "Las plantillas aún esperan aprobación",
  };

  return {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      clinics: {
        findFirst: vi.fn().mockResolvedValue({
          isSynthetic: false,
          subscriptionStatus: "active",
        }),
      },
      contactPatientLinks: { findFirst: vi.fn().mockResolvedValue(undefined) },
      contacts: {
        findFirst: vi.fn().mockResolvedValue({ phoneE164: "+50370000001" }),
      },
      whatsappCircuitBreakers: {
        findFirst: vi.fn().mockResolvedValue({
          reason: "high-failure-rate",
          status: input.circuitStatus ?? "open",
        }),
      },
      whatsappReadiness: { findFirst: vi.fn().mockResolvedValue(readiness) },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([run]),
          })),
        })),
      })),
    })),
  } as unknown as ClinicTransaction;
}
