import { describe, expect, it } from "vitest";

import {
  retryClinicInvitation,
  registerClinic,
  type ClinicRegistration,
  type ClinicRegistrationStore,
} from "./clinic-registration";

describe("alta explícita de Clínicas", () => {
  it("crea una Clínica comercial sin preparar una conexión sintética", async () => {
    const registration = pendingRegistration({ isSynthetic: false });
    const sent: string[] = [];
    const store = createStore(registration);

    const result = await registerClinic(
      {
        actorIdentityId: "superadmin-1",
        clinicName: "Clínica Aurora",
        idempotencyKey: "registration-1",
        mode: "commercial",
        owner: { email: "ana@aurora.test", name: "Dra. Ana Reyes" },
      },
      {
        sendOwnerInvitation: async (invitation) => {
          sent.push(invitation.token);
        },
        store,
      },
    );

    expect(result.clinic).toEqual({
      id: "clinic-1",
      isSynthetic: false,
      name: "Clínica Aurora",
    });
    expect(result.invitation.delivery).toMatchObject({
      lastAttempt: "succeeded",
      status: "sent",
    });
    expect(result.invitation).toMatchObject({
      nextAction: "accept",
      status: "pending",
    });
    expect(sent).toHaveLength(1);
  });

  it("devuelve la Clínica creada si el correo falla y permite recuperarlo", async () => {
    const registration = pendingRegistration({ isSynthetic: true });
    const store = createStore(registration);
    let shouldFail = true;

    const first = await registerClinic(
      {
        actorIdentityId: "superadmin-1",
        clinicName: "Clínica Aurora",
        idempotencyKey: "registration-2",
        mode: "synthetic",
        owner: { email: "ana@aurora.test", name: "Dra. Ana Reyes" },
      },
      {
        sendOwnerInvitation: async () => {
          if (shouldFail) throw new Error("Resend no disponible");
        },
        store,
      },
    );

    expect(first.clinic.id).toBe("clinic-1");
    expect(first.invitation.delivery).toMatchObject({
      canRetry: true,
      lastAttempt: "failed",
      lastError: "Resend no disponible",
      status: "pending",
    });
    expect(first.invitation).toMatchObject({ nextAction: "retry-delivery" });

    shouldFail = false;
    const retried = await retryClinicInvitation(
      { actorIdentityId: "superadmin-1", clinicId: first.clinic.id },
      {
        sendOwnerInvitation: async () => undefined,
        store,
      },
    );

    expect(retried.clinic.id).toBe(first.clinic.id);
    expect(retried.invitation.delivery).toMatchObject({
      attempts: 2,
      canRetry: false,
      lastAttempt: "succeeded",
      status: "sent",
    });
    expect(store.deliveryHistory).toHaveLength(2);
  });

  it("permite renovar una invitación vencida aunque el último correo sí se entregó", async () => {
    const registration = pendingRegistration({
      delivery: {
        attempts: 1,
        canRetry: true,
        lastAttempt: "succeeded",
        lastError: null,
        status: "sent",
      },
      invitationStatus: "expired",
      isSynthetic: false,
    });
    const store = createStore(registration);

    await retryClinicInvitation(
      { actorIdentityId: "superadmin-1", clinicId: registration.clinic.id },
      {
        sendOwnerInvitation: async () => undefined,
        store,
      },
    );

    expect(store.deliveryHistory).toHaveLength(1);
  });

  it("no duplica la Clínica ni el correo al repetir una alta ya entregada", async () => {
    const store = createStore(pendingRegistration({ isSynthetic: false }));
    let sends = 0;
    const input = {
      actorIdentityId: "superadmin-1",
      clinicName: "Clínica Aurora",
      idempotencyKey: "registration-3",
      mode: "commercial" as const,
      owner: { email: "ana@aurora.test", name: "Dra. Ana Reyes" },
    };
    const dependencies = {
      sendOwnerInvitation: async () => {
        sends += 1;
      },
      store,
    };

    const first = await registerClinic(input, dependencies);
    const second = await registerClinic(input, dependencies);

    expect(second.clinic.id).toBe(first.clinic.id);
    expect(second.invitation.id).toBe(first.invitation.id);
    expect(sends).toBe(1);
    expect(store.deliveryHistory).toHaveLength(1);
  });
});

function pendingRegistration(input: {
  delivery?: ClinicRegistration["invitation"]["delivery"];
  invitationStatus?: "accepted" | "expired" | "pending";
  isSynthetic: boolean;
}): ClinicRegistration {
  return {
    clinic: {
      id: "clinic-1",
      isSynthetic: input.isSynthetic,
      name: "Clínica Aurora",
    },
    invitation: {
      delivery: {
        attempts: input.delivery?.attempts ?? 0,
        canRetry: input.delivery?.canRetry ?? true,
        lastAttempt: input.delivery?.lastAttempt ?? null,
        lastError: input.delivery?.lastError ?? null,
        status: input.delivery?.status ?? "pending",
      },
      email: "ana@aurora.test",
      expiresAt:
        input.invitationStatus === "expired"
          ? new Date("2026-09-16T00:00:00.000Z")
          : new Date("2026-09-19T00:00:00.000Z"),
      id: "invitation-1",
      nextAction: input.invitationStatus === "expired" ? "renew" : "accept",
      recipientName: "Dra. Ana Reyes",
      status: input.invitationStatus ?? "pending",
    },
  };
}

function createStore(
  registration: ClinicRegistration,
): ClinicRegistrationStore & { deliveryHistory: Array<unknown> } {
  let current = registration;
  const deliveryHistory: Array<unknown> = [];

  const store = {
    deliveryHistory,
    async register() {
      return {
        created: deliveryHistory.length === 0,
        registration: current,
      };
    },
    async prepareInvitationDelivery() {
      return {
        clinicId: current.clinic.id,
        clinicName: current.clinic.name,
        deliveryAttemptId: `attempt-${deliveryHistory.length + 1}`,
        email: current.invitation.email,
        expiresAt: current.invitation.expiresAt,
        invitationId: current.invitation.id,
        recipientName: current.invitation.recipientName,
        token: `token-${deliveryHistory.length + 1}`,
      };
    },
    async read() {
      return current;
    },
    async recordInvitationDelivery(input: {
      deliveryAttemptId: string;
      result: "failed" | "succeeded";
      failureReason?: string;
    }) {
      deliveryHistory.push(input);
      current = {
        ...current,
        invitation: {
          ...current.invitation,
          delivery: {
            attempts: deliveryHistory.length,
            canRetry: input.result === "failed",
            lastAttempt: input.result,
            lastError: input.failureReason ?? null,
            status: input.result === "succeeded" ? "sent" : "pending",
          },
          nextAction: input.result === "failed" ? "retry-delivery" : "accept",
          status: "pending",
        },
      };
      return current;
    },
  } satisfies ClinicRegistrationStore & { deliveryHistory: Array<unknown> };

  return store;
}
