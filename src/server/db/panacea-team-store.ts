import { and, asc, eq, inArray } from "drizzle-orm";

import type {
  PanaceaTeamReader,
  PanaceaTeamReaderResult,
} from "~/server/application/panacea-team";
import { inClinicTransaction } from "~/server/db/clinic-context";
import {
  clinicInvitations,
  clinicUsers,
  doctors,
  user as identities,
} from "~/server/db/schema";

export const drizzlePanaceaTeamReader: PanaceaTeamReader = {
  async read(input) {
    return inClinicTransaction(input, async (transaction) => {
      const owner = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.active, true),
          eq(clinicUsers.role, "owner"),
        ),
      });
      if (owner === undefined) return undefined;

      const rows = await transaction
        .select({
          doctorActive: doctors.active,
          doctorId: doctors.id,
          email: identities.email,
          name: identities.name,
          primarySpecialty: doctors.primarySpecialty,
          publicName: doctors.publicName,
          role: clinicUsers.role,
        })
        .from(clinicUsers)
        .innerJoin(identities, eq(clinicUsers.identityId, identities.id))
        .leftJoin(
          doctors,
          and(
            eq(doctors.clinicId, clinicUsers.clinicId),
            eq(doctors.clinicUserId, clinicUsers.id),
          ),
        )
        .where(
          and(
            eq(clinicUsers.clinicId, input.clinicId),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          ),
        )
        .orderBy(asc(clinicUsers.createdAt));

      const invitations = await transaction.query.clinicInvitations.findMany({
        columns: {
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

      return {
        doctors: rows.flatMap((row) => {
          if (row.doctorId === null || row.role === "secretary") return [];
          return [
            {
              active: row.doctorActive ?? false,
              email: row.email,
              id: row.doctorId,
              name: row.name,
              primarySpecialty: row.primarySpecialty,
              publicName: row.publicName,
              role: row.role,
            },
          ];
        }),
        invitations: invitations.map((invitation) => ({
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
        })),
      } satisfies PanaceaTeamReaderResult;
    });
  },
};
