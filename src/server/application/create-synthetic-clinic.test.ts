import { describe, expect, it } from "vitest";

import {
  createSyntheticClinic,
  type SyntheticClinic,
  type SyntheticClinicRegistration,
} from "./create-synthetic-clinic";

describe("alta controlada de Clínica sintética", () => {
  it("persiste la Clínica y la invitación, las audita y envía el correo simulado", async () => {
    const registry = createRegistry(["superadmin-1"]);
    const sentInvitations: Array<{
      clinicName: string;
      expiresAt: Date;
      ownerEmail: string;
      ownerName: string;
      token: string;
    }> = [];

    const clinic = await createSyntheticClinic(
      {
        actorIdentityId: "superadmin-1",
        clinicName: "Clínica Aurora",
        owner: { email: "ana@aurora.test", name: "Dra. Ana Reyes" },
      },
      {
        registry,
        sendOwnerInvitation: async (invitation) => {
          sentInvitations.push(invitation);
        },
      },
    );

    expect(clinic).toEqual({
      id: "clinic-1",
      isSynthetic: true,
      name: "Clínica Aurora",
    });
    expect(registry.clinics).toEqual([clinic]);
    expect(sentInvitations).toHaveLength(1);
    expect(sentInvitations[0]).toMatchObject({
      clinicName: "Clínica Aurora",
      ownerEmail: "ana@aurora.test",
      ownerName: "Dra. Ana Reyes",
    });
    expect(registry.auditEvents).toEqual([
      {
        action: "synthetic-clinic-created",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
        result: "succeeded",
      },
      {
        action: "clinic-owner-invited",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
        result: "succeeded",
      },
    ]);
    expect(JSON.stringify(registry.auditEvents)).not.toContain(
      sentInvitations[0]?.token ?? "",
    );
  });

  it("rechaza a una Identidad no autorizada para esta operación", async () => {
    const registry = createRegistry([]);

    await expect(
      createSyntheticClinic(
        {
          actorIdentityId: "identity-1",
          clinicName: "Clínica Aurora",
          owner: { email: "ana@aurora.test", name: "Dra. Ana Reyes" },
        },
        { registry, sendOwnerInvitation: async () => undefined },
      ),
    ).rejects.toThrow("La Identidad no está autorizada para esta operación");
  });

  it("audita una invitación fallida sin conservar su secreto", async () => {
    const registry = createRegistry(["superadmin-1"]);

    await expect(
      createSyntheticClinic(
        {
          actorIdentityId: "superadmin-1",
          clinicName: "Clínica Aurora",
          owner: { email: "ana@aurora.test", name: "Dra. Ana Reyes" },
        },
        {
          registry,
          sendOwnerInvitation: async () => {
            throw new Error("El correo simulado no está disponible");
          },
        },
      ),
    ).rejects.toThrow("El correo simulado no está disponible");

    expect(registry.auditEvents.at(-1)).toEqual({
      action: "clinic-owner-invited",
      actorIdentityId: "superadmin-1",
      clinicId: "clinic-1",
      result: "failed",
    });
  });
});

function createRegistry(superadminIdentityIds: string[]) {
  const clinics: SyntheticClinic[] = [];
  const auditEvents: Array<{
    action: "clinic-owner-invited" | "synthetic-clinic-created";
    actorIdentityId: string;
    clinicId: string;
    result: "failed" | "succeeded";
  }> = [];

  return {
    clinics,
    auditEvents,
    async register(
      input: Parameters<SyntheticClinicRegistration["register"]>[0],
    ) {
      if (!superadminIdentityIds.includes(input.actorIdentityId)) {
        throw new Error("La Identidad no está autorizada para esta operación");
      }

      const clinic = {
        id: `clinic-${clinics.length + 1}`,
        isSynthetic: true as const,
        name: input.clinicName,
      };
      clinics.push(clinic);
      auditEvents.push({
        action: "synthetic-clinic-created",
        actorIdentityId: input.actorIdentityId,
        clinicId: clinic.id,
        result: "succeeded",
      });

      return { clinic, invitation: input.invitation };
    },
    async recordInvitationDelivery(
      input: Parameters<
        SyntheticClinicRegistration["recordInvitationDelivery"]
      >[0],
    ) {
      auditEvents.push({
        action: "clinic-owner-invited",
        actorIdentityId: input.actorIdentityId,
        clinicId: input.clinicId,
        result: input.result,
      });
    },
  };
}
