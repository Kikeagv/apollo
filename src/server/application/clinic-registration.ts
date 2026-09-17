import { randomUUID } from "node:crypto";

import type {
  ClinicInvitationNextAction,
  ClinicInvitationStatus,
} from "~/domain/clinic-invitation";

export const clinicRegistrationModes = ["commercial", "synthetic"] as const;
export type ClinicRegistrationMode = (typeof clinicRegistrationModes)[number];

export type ClinicInvitationDeliveryAttempt = "failed" | "succeeded";
export type ClinicInvitationDeliveryStatus = "pending" | "sent";

export type ClinicRegistration = {
  clinic: {
    id: string;
    isSynthetic: boolean;
    name: string;
  };
  invitation: {
    delivery: {
      attempts: number;
      canRetry: boolean;
      lastAttempt: ClinicInvitationDeliveryAttempt | null;
      lastError: string | null;
      status: ClinicInvitationDeliveryStatus;
    };
    email: string;
    expiresAt: Date;
    id: string;
    nextAction: ClinicInvitationNextAction;
    recipientName: string;
    status: ClinicInvitationStatus;
  };
};

export type ClinicInvitationDeliveryRequest = {
  clinicId: string;
  clinicName: string;
  deliveryAttemptId: string;
  email: string;
  expiresAt: Date;
  invitationId: string;
  recipientName: string;
  token: string;
};

export type ClinicRegistrationStore = {
  register(input: {
    actorIdentityId: string;
    clinicName: string;
    idempotencyKey: string;
    invitation: {
      deliveryAttemptId: string;
      expiresAt: Date;
      token: string;
    };
    mode: ClinicRegistrationMode;
    owner: { email: string; name: string };
  }): Promise<{ created: boolean; registration: ClinicRegistration }>;
  prepareInvitationDelivery(input: {
    actorIdentityId: string;
    clinicId: string;
    expiresAt: Date;
    token: string;
  }): Promise<ClinicInvitationDeliveryRequest | undefined>;
  read(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<ClinicRegistration>;
  recordInvitationDelivery(input: {
    actorIdentityId: string;
    clinicId: string;
    deliveryAttemptId: string;
    failureReason?: string;
    invitationId: string;
    result: ClinicInvitationDeliveryAttempt;
  }): Promise<ClinicRegistration>;
};

export class ClinicRegistrationConflictError extends Error {
  constructor() {
    super(
      "La clave de idempotencia ya corresponde a una Clínica con otros datos",
    );
    this.name = "ClinicRegistrationConflictError";
  }
}

type ClinicRegistrationInput = {
  actorIdentityId: string;
  clinicName: string;
  idempotencyKey: string;
  mode: ClinicRegistrationMode;
  owner: { email: string; name: string };
};

type ClinicRegistrationDependencies = {
  sendOwnerInvitation(
    invitation: ClinicInvitationDeliveryRequest,
  ): Promise<void>;
  store: ClinicRegistrationStore;
};

const INVITATION_DURATION_MS = 72 * 60 * 60 * 1000;

export async function registerClinic(
  input: ClinicRegistrationInput,
  dependencies: ClinicRegistrationDependencies,
) {
  const invitation = {
    deliveryAttemptId: randomUUID(),
    expiresAt: new Date(Date.now() + INVITATION_DURATION_MS),
    token: randomUUID(),
  };
  const registered = await dependencies.store.register({
    ...input,
    invitation,
  });

  if (registered.registration.invitation.delivery.status === "sent") {
    return registered.registration;
  }

  const delivery = registered.created
    ? {
        clinicId: registered.registration.clinic.id,
        clinicName: registered.registration.clinic.name,
        deliveryAttemptId: invitation.deliveryAttemptId,
        email: registered.registration.invitation.email,
        expiresAt: invitation.expiresAt,
        invitationId: registered.registration.invitation.id,
        recipientName: registered.registration.invitation.recipientName,
        token: invitation.token,
      }
    : await dependencies.store.prepareInvitationDelivery({
        actorIdentityId: input.actorIdentityId,
        clinicId: registered.registration.clinic.id,
        expiresAt: invitation.expiresAt,
        token: invitation.token,
      });

  if (delivery === undefined) {
    return dependencies.store.read({
      actorIdentityId: input.actorIdentityId,
      clinicId: registered.registration.clinic.id,
    });
  }

  return deliverInvitation(delivery, input.actorIdentityId, dependencies);
}

export async function retryClinicInvitation(
  input: { actorIdentityId: string; clinicId: string },
  dependencies: ClinicRegistrationDependencies,
) {
  const current = await dependencies.store.read(input);
  if (!current.invitation.delivery.canRetry) return current;

  const delivery = await dependencies.store.prepareInvitationDelivery({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    expiresAt: new Date(Date.now() + INVITATION_DURATION_MS),
    token: randomUUID(),
  });
  if (delivery === undefined) return dependencies.store.read(input);

  return deliverInvitation(delivery, input.actorIdentityId, dependencies);
}

async function deliverInvitation(
  invitation: ClinicInvitationDeliveryRequest,
  actorIdentityId: string,
  dependencies: ClinicRegistrationDependencies,
) {
  try {
    await dependencies.sendOwnerInvitation(invitation);
  } catch (error) {
    return dependencies.store.recordInvitationDelivery({
      actorIdentityId,
      clinicId: invitation.clinicId,
      deliveryAttemptId: invitation.deliveryAttemptId,
      failureReason: deliveryErrorMessage(error),
      invitationId: invitation.invitationId,
      result: "failed",
    });
  }

  return dependencies.store.recordInvitationDelivery({
    actorIdentityId,
    clinicId: invitation.clinicId,
    deliveryAttemptId: invitation.deliveryAttemptId,
    invitationId: invitation.invitationId,
    result: "succeeded",
  });
}

function deliveryErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.trim().slice(0, 500);
  }
  return "El proveedor de correo no pudo entregar la invitación";
}
