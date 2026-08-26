import { describe, expect, it } from "vitest";

import {
  activeSupportSessions,
  createSubscriptionSupport,
  type SubscriptionSupportStore,
  type SupportSession,
} from "./subscription-support";

describe("operación comercial y soporte auditado", () => {
  it("solo presenta sesiones de soporte que todavía están vigentes", () => {
    const sessions: SupportSession[] = [
      {
        clinicId: "clinica-aurora",
        expiresAt: new Date("2026-08-16T12:00:01Z"),
        id: "support-active",
        reason: "Sesión vigente",
        superadminIdentityId: "superadmin-1",
      },
      {
        clinicId: "clinica-aurora",
        expiresAt: new Date("2026-08-16T12:00:00Z"),
        id: "support-expired",
        reason: "Sesión vencida",
        superadminIdentityId: "superadmin-1",
      },
    ];

    expect(
      activeSupportSessions(sessions, new Date("2026-08-16T12:00:00Z")),
    ).toEqual([sessions[0]]);
  });

  it("registra un pago por transferencia y la transición de suscripción sin abrir acceso clínico", async () => {
    const store = createStore(["superadmin-1"]);
    const support = createSubscriptionSupport(
      store,
      () => new Date("2026-08-16T12:00:00Z"),
    );

    await support.recordTransferPayment({
      amountUsd: "75.00",
      clinicId: "clinica-aurora",
      recordedByIdentityId: "superadmin-1",
      reference: "TRX-001",
    });
    await support.changeSubscriptionStatus({
      clinicId: "clinica-aurora",
      changedByIdentityId: "superadmin-1",
      status: "suspended",
    });

    expect(store.payments).toEqual([
      expect.objectContaining({
        amountUsd: "75.00",
        clinicId: "clinica-aurora",
        reference: "TRX-001",
      }),
    ]);
    expect(store.subscriptionStatuses).toEqual([
      { clinicId: "clinica-aurora", status: "suspended" },
    ]);
    expect(store.supportSessions).toEqual([]);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "transfer-payment-recorded" }),
        expect.objectContaining({ action: "subscription-status-changed" }),
      ]),
    );
  });

  it("abre soporte explícito, vencible y visible para la Clínica", async () => {
    const store = createStore(["superadmin-1"]);
    const support = createSubscriptionSupport(
      store,
      () => new Date("2026-08-16T12:00:00Z"),
    );

    const session = await support.openSupportSession({
      clinicId: "clinica-aurora",
      expiresAt: new Date("2026-08-16T13:00:00Z"),
      reason: "Revisar la configuración de la agenda",
      superadminIdentityId: "superadmin-1",
    });

    await expect(
      support.listVisibleSupportSessions({
        clinicId: "clinica-aurora",
        clinicIdentityId: "owner-aurora",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        expiresAt: new Date("2026-08-16T13:00:00Z"),
        id: session.id,
        reason: "Revisar la configuración de la agenda",
      }),
    ]);
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "support-session-opened",
        clinicId: "clinica-aurora",
      }),
    );
  });
});

function createStore(
  superadminIdentityIds: string[],
): SubscriptionSupportStore & {
  auditEvents: Array<{ action: string; clinicId: string }>;
  payments: Array<{ amountUsd: string; clinicId: string; reference: string }>;
  subscriptionStatuses: Array<{
    clinicId: string;
    status: "active" | "suspended";
  }>;
  supportSessions: Array<{
    clinicId: string;
    expiresAt: Date;
    id: string;
    reason: string;
    superadminIdentityId: string;
  }>;
} {
  const auditEvents: Array<{ action: string; clinicId: string }> = [];
  const payments: Array<{
    amountUsd: string;
    clinicId: string;
    reference: string;
  }> = [];
  const subscriptionStatuses: Array<{
    clinicId: string;
    status: "active" | "suspended";
  }> = [];
  const supportSessions: Array<{
    clinicId: string;
    expiresAt: Date;
    id: string;
    reason: string;
    superadminIdentityId: string;
  }> = [];

  return {
    auditEvents,
    payments,
    subscriptionStatuses,
    supportSessions,
    async assertSuperadmin(identityId) {
      if (!superadminIdentityIds.includes(identityId)) {
        throw new Error("La Identidad no es superadmin de Apolo");
      }
    },
    async authorizeClinicIdentity() {
      return undefined;
    },
    async changeSubscriptionStatus(input) {
      subscriptionStatuses.push({
        clinicId: input.clinicId,
        status: input.status,
      });
    },
    async createSupportSession(input) {
      const session = { id: `support-${supportSessions.length + 1}`, ...input };
      supportSessions.push(session);
      return session;
    },
    async listSupportSessions(input) {
      return supportSessions.filter(
        (session) => session.clinicId === input.clinicId,
      );
    },
    async recordAuditEvent(event) {
      auditEvents.push({ action: event.action, clinicId: event.clinicId });
    },
    async recordTransferPayment(payment) {
      payments.push(payment);
    },
  };
}
