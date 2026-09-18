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
        operationKey: "support-session:active",
        reason: "Sesión vigente",
        superadminIdentityId: "superadmin-1",
      },
      {
        clinicId: "clinica-aurora",
        expiresAt: new Date("2026-08-16T12:00:00Z"),
        id: "support-expired",
        operationKey: "support-session:expired",
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
    const support = createSubscriptionSupport(store);

    const paymentInput = {
      amountUsd: "75.00",
      clinicId: "clinica-aurora",
      operationKey: "transfer-payment:attempt-1",
      recordedByIdentityId: "superadmin-1",
      reference: "TRX-001",
    };
    const firstPayment = await support.recordTransferPayment(paymentInput);
    const repeatedPayment = await support.recordTransferPayment(paymentInput);
    const subscription = await support.changeSubscriptionStatus({
      clinicId: "clinica-aurora",
      changedByIdentityId: "superadmin-1",
      operationKey: "subscription-status:attempt-1",
      status: "suspended",
    });

    expect(repeatedPayment).toEqual(firstPayment);
    expect(firstPayment).toMatchObject({
      operationKey: paymentInput.operationKey,
      status: "succeeded",
    });
    expect(subscription).toMatchObject({
      operationKey: "subscription-status:attempt-1",
      status: "succeeded",
      subscriptionStatus: "suspended",
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
    const support = createSubscriptionSupport(store);

    const supportInput = {
      clinicId: "clinica-aurora",
      expiresAt: new Date("2026-08-16T13:00:00Z"),
      operationKey: "support-session:attempt-1",
      reason: "Revisar la configuración de la agenda",
      superadminIdentityId: "superadmin-1",
    };
    const session = await support.openSupportSession(supportInput);
    const repeatedSession = await support.openSupportSession(supportInput);

    expect(repeatedSession).toEqual(session);
    expect(session.operationKey).toBe(supportInput.operationKey);
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

  it("recupera una apertura de soporte aunque el vencimiento ya haya pasado", async () => {
    const store = createStore(["superadmin-1"]);
    const input = {
      clinicId: "clinica-aurora",
      expiresAt: new Date("2026-08-16T13:00:00Z"),
      operationKey: "support-session:expired-response",
      reason: "Revisar una respuesta que tardó",
      superadminIdentityId: "superadmin-1",
    };
    const firstSupport = createSubscriptionSupport(store);
    const session = await firstSupport.openSupportSession(input);
    const retrySupport = createSubscriptionSupport(store);

    await expect(retrySupport.openSupportSession(input)).resolves.toEqual(
      session,
    );
  });

  it("permite reintentar con la misma clave después de un fallo de auditoría sin duplicar el pago", async () => {
    const store = createStore(["superadmin-1"]);
    store.failNextPaymentAudit = true;
    const support = createSubscriptionSupport(store);
    const input = {
      amountUsd: "25.00",
      clinicId: "clinica-aurora",
      operationKey: "transfer-payment:audit-retry",
      recordedByIdentityId: "superadmin-1",
      reference: "TRX-RETRY",
    };

    await expect(support.recordTransferPayment(input)).rejects.toThrow(
      "auditoría",
    );
    expect(store.payments).toHaveLength(0);
    await expect(support.recordTransferPayment(input)).resolves.toMatchObject({
      operationKey: input.operationKey,
      status: "succeeded",
    });
    expect(store.payments).toHaveLength(1);
    expect(
      store.auditEvents.filter(
        (event) => event.action === "transfer-payment-recorded",
      ),
    ).toHaveLength(1);
  });
});

function createStore(
  superadminIdentityIds: string[],
): SubscriptionSupportStore & {
  auditEvents: Array<{ action: string; clinicId: string }>;
  failNextPaymentAudit: boolean;
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
    operationKey: string;
    reason: string;
    superadminIdentityId: string;
  }> = [];

  const paymentOperations = new Map<
    string,
    Awaited<ReturnType<SubscriptionSupportStore["recordTransferPayment"]>>
  >();
  const subscriptionOperations = new Map<
    string,
    Awaited<ReturnType<SubscriptionSupportStore["changeSubscriptionStatus"]>>
  >();
  const supportOperations = new Map<string, SupportSession>();

  return {
    auditEvents,
    failNextPaymentAudit: false,
    payments,
    subscriptionStatuses,
    supportSessions,
    async assertSuperadmin(identityId) {
      if (!superadminIdentityIds.includes(identityId)) {
        throw new Error("La Identidad no está autorizada para esta operación");
      }
    },
    async authorizeClinicIdentity() {
      return undefined;
    },
    async changeSubscriptionStatus(input) {
      const previous = subscriptionOperations.get(input.operationKey);
      if (previous !== undefined) return previous;
      subscriptionStatuses.push({
        clinicId: input.clinicId,
        status: input.status,
      });
      const result = {
        operationKey: input.operationKey,
        status: "succeeded" as const,
        subscriptionStatus: input.status,
      };
      subscriptionOperations.set(input.operationKey, result);
      auditEvents.push({
        action: "subscription-status-changed",
        clinicId: input.clinicId,
      });
      return result;
    },
    async createSupportSession(input) {
      const previous = supportOperations.get(input.operationKey);
      if (previous !== undefined) return previous;
      const session = {
        id: `support-${supportSessions.length + 1}`,
        ...input,
      };
      supportSessions.push(session);
      supportOperations.set(input.operationKey, session);
      auditEvents.push({
        action: "support-session-opened",
        clinicId: input.clinicId,
      });
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
      const previous = paymentOperations.get(payment.operationKey);
      if (previous !== undefined) return previous;
      payments.push(payment);
      if (this.failNextPaymentAudit) {
        this.failNextPaymentAudit = false;
        payments.pop();
        throw new Error("No se pudo escribir la auditoría");
      }
      const result = {
        operationKey: payment.operationKey,
        paymentId: `payment-${payments.length}`,
        recordedAt: new Date("2026-08-16T12:00:00Z"),
        status: "succeeded" as const,
      };
      paymentOperations.set(payment.operationKey, result);
      auditEvents.push({
        action: "transfer-payment-recorded",
        clinicId: payment.clinicId,
      });
      return result;
    },
  };
}
