export type SubscriptionStatus = "active" | "suspended";

export type SupportSession = {
  clinicId: string;
  expiresAt: Date;
  id: string;
  reason: string;
  superadminIdentityId: string;
};

export function activeSupportSessions<
  T extends Pick<SupportSession, "expiresAt">,
>(sessions: readonly T[], now: Date) {
  return sessions.filter(
    (session) => session.expiresAt.getTime() > now.getTime(),
  );
}

export function assertSupportSessionIsUsable(
  session: SupportSession | undefined,
  input: { clinicId: string; superadminIdentityId: string },
  now: Date,
) {
  if (session?.clinicId !== input.clinicId) {
    throw new Error("La sesión de soporte no autoriza esta Clínica");
  }
  if (session.superadminIdentityId !== input.superadminIdentityId) {
    throw new Error("La sesión de soporte pertenece a otro superadmin");
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new Error("La sesión de soporte venció");
  }
  return session;
}

export type SubscriptionSupportStore = {
  assertSuperadmin(identityId: string): Promise<void>;
  authorizeClinicIdentity(input: {
    clinicId: string;
    identityId: string;
  }): Promise<void>;
  changeSubscriptionStatus(input: {
    changedByIdentityId: string;
    clinicId: string;
    status: SubscriptionStatus;
  }): Promise<void>;
  createSupportSession(
    input: Omit<SupportSession, "id">,
  ): Promise<SupportSession>;
  listSupportSessions(input: {
    clinicId: string;
    clinicIdentityId: string;
  }): Promise<SupportSession[]>;
  recordAuditEvent(input: {
    action:
      | "subscription-status-changed"
      | "support-access-used"
      | "support-session-opened"
      | "transfer-payment-recorded";
    actorIdentityId: string;
    clinicId: string;
    result: "succeeded";
    supportSessionId?: string;
  }): Promise<void>;
  recordTransferPayment(input: {
    amountUsd: string;
    clinicId: string;
    recordedByIdentityId: string;
    reference: string;
  }): Promise<void>;
};

export function createSubscriptionSupport(
  store: SubscriptionSupportStore,
  now: () => Date = () => new Date(),
) {
  return {
    async recordTransferPayment(input: {
      amountUsd: string;
      clinicId: string;
      recordedByIdentityId: string;
      reference: string;
    }) {
      await store.assertSuperadmin(input.recordedByIdentityId);
      await store.recordTransferPayment(input);
      await store.recordAuditEvent({
        action: "transfer-payment-recorded",
        actorIdentityId: input.recordedByIdentityId,
        clinicId: input.clinicId,
        result: "succeeded",
      });
    },

    async changeSubscriptionStatus(input: {
      changedByIdentityId: string;
      clinicId: string;
      status: SubscriptionStatus;
    }) {
      await store.assertSuperadmin(input.changedByIdentityId);
      await store.changeSubscriptionStatus(input);
      await store.recordAuditEvent({
        action: "subscription-status-changed",
        actorIdentityId: input.changedByIdentityId,
        clinicId: input.clinicId,
        result: "succeeded",
      });
    },

    async openSupportSession(input: {
      clinicId: string;
      expiresAt: Date;
      reason: string;
      superadminIdentityId: string;
    }) {
      await store.assertSuperadmin(input.superadminIdentityId);
      if (input.reason.trim().length === 0) {
        throw new Error("El soporte requiere un motivo");
      }
      if (input.expiresAt.getTime() <= now().getTime()) {
        throw new Error("El soporte requiere un vencimiento futuro");
      }
      const session = await store.createSupportSession({
        ...input,
        reason: input.reason.trim(),
      });
      await store.recordAuditEvent({
        action: "support-session-opened",
        actorIdentityId: input.superadminIdentityId,
        clinicId: input.clinicId,
        result: "succeeded",
      });
      return session;
    },

    async listVisibleSupportSessions(input: {
      clinicId: string;
      clinicIdentityId: string;
    }) {
      await store.authorizeClinicIdentity({
        clinicId: input.clinicId,
        identityId: input.clinicIdentityId,
      });
      return store.listSupportSessions(input);
    },
  };
}
