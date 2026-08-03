import { describe, expect, it, vi } from "vitest";

import {
  DoctorInvitationAccessError,
  inviteAdditionalDoctor,
  type DoctorInvitationStore,
} from "./doctor-invitations";

describe("incorporar Médicos adicionales", () => {
  it("permite al Médico propietario invitar a un Médico y consultar su estado pendiente", async () => {
    const store: DoctorInvitationStore = {
      inviteDoctor: vi.fn().mockResolvedValue({
        clinicId: "clinic-1",
        clinicName: "Clínica Aurora",
        email: "luis@aurora.test",
        expiresAt: new Date("2026-08-06T12:00:00Z"),
        id: "invitation-1",
        recipientName: "Dr. Luis Pérez",
        status: "pending",
        token: "token-1",
      }),
      recordInvitationDelivery: vi.fn().mockResolvedValue(undefined),
    };
    const sendInvitation = vi.fn().mockResolvedValue(undefined);

    await expect(
      inviteAdditionalDoctor(
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          recipient: {
            email: "  LUIS@Aurora.test  ",
            name: "  Dr. Luis Pérez  ",
          },
        },
        { sendInvitation, store },
      ),
    ).resolves.toMatchObject({
      email: "luis@aurora.test",
      recipientName: "Dr. Luis Pérez",
      status: "pending",
    });
  });

  it("deniega a un Médico no propietario iniciar invitaciones", async () => {
    const store: DoctorInvitationStore = {
      inviteDoctor: vi.fn().mockResolvedValue(undefined),
      recordInvitationDelivery: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      inviteAdditionalDoctor(
        {
          clinicId: "clinic-1",
          identityId: "doctor-1",
          recipient: { email: "luis@aurora.test", name: "Dr. Luis Pérez" },
        },
        { sendInvitation: vi.fn(), store },
      ),
    ).rejects.toBeInstanceOf(DoctorInvitationAccessError);
  });

  it("deniega a una Secretaria iniciar invitaciones", async () => {
    const store: DoctorInvitationStore = {
      inviteDoctor: vi.fn().mockResolvedValue(undefined),
      recordInvitationDelivery: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      inviteAdditionalDoctor(
        {
          clinicId: "clinic-1",
          identityId: "secretary-1",
          recipient: { email: "luis@aurora.test", name: "Dr. Luis Pérez" },
        },
        { sendInvitation: vi.fn(), store },
      ),
    ).rejects.toBeInstanceOf(DoctorInvitationAccessError);
  });
});
