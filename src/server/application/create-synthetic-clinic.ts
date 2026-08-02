import { randomUUID } from "node:crypto";

export type SyntheticClinic = {
  id: string;
  isSynthetic: true;
  name: string;
};

type OwnerInvitation = {
  expiresAt: Date;
  ownerEmail: string;
  ownerName: string;
  token: string;
};

export type SyntheticClinicRegistration = {
  register(input: {
    actorIdentityId: string;
    clinicName: string;
    invitation: OwnerInvitation;
  }): Promise<{ clinic: SyntheticClinic; invitation: OwnerInvitation }>;
};

type CreateSyntheticClinicDependencies = {
  registry: SyntheticClinicRegistration;
  sendOwnerInvitation(
    invitation: OwnerInvitation & { clinicName: string },
  ): Promise<void>;
};

export async function createSyntheticClinic(
  input: {
    actorIdentityId: string;
    clinicName: string;
    owner: { email: string; name: string };
  },
  dependencies: CreateSyntheticClinicDependencies,
) {
  const invitation = {
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    ownerEmail: input.owner.email,
    ownerName: input.owner.name,
    token: randomUUID(),
  };
  const registration = await dependencies.registry.register({
    actorIdentityId: input.actorIdentityId,
    clinicName: input.clinicName,
    invitation,
  });

  await dependencies.sendOwnerInvitation({
    ...registration.invitation,
    clinicName: registration.clinic.name,
  });

  return registration.clinic;
}
