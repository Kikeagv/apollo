import { and, eq } from "drizzle-orm";

import {
  type DoctorInvitation,
  type DoctorInvitationStore,
} from "~/server/application/doctor-invitations";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { hashClinicInvitationToken } from "~/server/db/clinic-invitation-token";
import {
  clinics,
  clinicInvitations,
  clinicUsers,
  identityAuditEvents,
} from "~/server/db/schema";

export const drizzleDoctorInvitationStore: DoctorInvitationStore = {
  async inviteDoctor(input) {
    return inClinicTransaction(input, async (transaction) => {
      const owner = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.role, "owner"),
        ),
      });
      if (owner === undefined) return undefined;

      const clinic = await transaction.query.clinics.findFirst({
        columns: { name: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) return undefined;

      const [created] = await transaction
        .insert(clinicInvitations)
        .values({
          clinicId: input.clinicId,
          email: input.email,
          expiresAt: input.expiresAt,
          recipientName: input.recipientName,
          role: "doctor",
          tokenHash: hashClinicInvitationToken(input.token),
        })
        .returning({ id: clinicInvitations.id });
      if (created === undefined)
        throw new Error("No se pudo crear la invitación");

      await transaction.insert(identityAuditEvents).values({
        action: "clinic-doctor-invited",
        actorIdentityId: input.identityId,
        actorKind: "identity",
        clinicId: input.clinicId,
        result: "succeeded",
      });

      return {
        clinicId: input.clinicId,
        clinicName: clinic.name,
        email: input.email,
        expiresAt: input.expiresAt,
        id: created.id,
        recipientName: input.recipientName,
        status: "pending" as const,
        token: input.token,
      };
    });
  },

  async recordInvitationDelivery(input) {
    await inClinicTransaction(input, async (transaction) => {
      await transaction.insert(identityAuditEvents).values({
        action: "clinic-doctor-invitation-delivered",
        actorIdentityId: input.identityId,
        actorKind: "identity",
        clinicId: input.clinicId,
        result: input.result,
      });
    });
  },
};

export type DoctorInvitationStatus = Omit<DoctorInvitation, "token">;

/** El propietario consulta el estado de las invitaciones de Médicos de su Clínica. */
export async function listDoctorInvitationStatuses(input: {
  clinicId: string;
  identityId: string;
}): Promise<DoctorInvitationStatus[]> {
  return inClinicTransaction(input, async (transaction) => {
    const owner = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.role, "owner"),
      ),
    });
    if (owner === undefined) return [];

    const clinic = await transaction.query.clinics.findFirst({
      columns: { name: true },
      where: eq(clinics.id, input.clinicId),
    });
    if (clinic === undefined) return [];

    const invitations = await transaction.query.clinicInvitations.findMany({
      columns: {
        clinicId: true,
        consumedAt: true,
        email: true,
        expiresAt: true,
        id: true,
        recipientName: true,
      },
      orderBy: (table, { desc }) => [desc(table.expiresAt)],
      where: and(
        eq(clinicInvitations.clinicId, input.clinicId),
        eq(clinicInvitations.role, "doctor"),
      ),
    });
    const now = new Date();
    return invitations.map((invitation) => ({
      clinicId: invitation.clinicId,
      clinicName: clinic.name,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      id: invitation.id,
      recipientName: invitation.recipientName,
      status:
        invitation.consumedAt !== null
          ? "accepted"
          : invitation.expiresAt <= now
            ? "expired"
            : "pending",
    }));
  });
}
