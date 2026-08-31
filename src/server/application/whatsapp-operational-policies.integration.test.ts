import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  EscalationNotificationSettingsAccessError,
  getEscalationNotificationSettings,
  setEscalationNotificationSettings,
} from "./conversation-escalations";
import { getNoShowPolicy, setNoShowPolicy } from "./no-show-policy";
import {
  getVoiceTranscriptionSettings,
  setVoiceTranscriptionSettings,
} from "./voice-note-transcription-settings";
import { db } from "../db";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  configurationAuditEvents,
  user as identities,
} from "../db/schema";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleNoShowPolicyStore } from "../db/no-show-policy-store";
import {
  drizzleEscalationNotificationSettingsStore,
  drizzleVoiceTranscriptionSettingsStore,
} from "../db/simulated-whatsapp-booking-store";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("políticas operativas de WhatsApp con RLS y auditoría", () => {
  databaseTest(
    "el propietario puede leer y actualizar las tres políticas",
    async () => {
      const fixture = await createFixture();

      try {
        await expect(
          getNoShowPolicy(
            { clinicId: fixture.clinicId, identityId: fixture.ownerId },
            drizzleNoShowPolicyStore,
          ),
        ).resolves.toBe("alert");
        await expect(
          setNoShowPolicy(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.ownerId,
              policy: "cancel-after-third-reminder",
            },
            drizzleNoShowPolicyStore,
          ),
        ).resolves.toBe("cancel-after-third-reminder");

        await expect(
          setEscalationNotificationSettings(
            {
              clinicId: fixture.clinicId,
              enabled: true,
              identityId: fixture.ownerId,
              secretaryPhoneE164: " +50370000000 ",
            },
            drizzleEscalationNotificationSettingsStore,
          ),
        ).resolves.toEqual({
          enabled: true,
          secretaryPhoneE164: "+50370000000",
        });
        await expect(
          getEscalationNotificationSettings(
            { clinicId: fixture.clinicId, identityId: fixture.ownerId },
            drizzleEscalationNotificationSettingsStore,
          ),
        ).resolves.toEqual({
          enabled: true,
          secretaryPhoneE164: "+50370000000",
        });

        await expect(
          setVoiceTranscriptionSettings(
            {
              clinicId: fixture.clinicId,
              enabled: true,
              identityId: fixture.ownerId,
            },
            drizzleVoiceTranscriptionSettingsStore,
          ),
        ).resolves.toEqual({ enabled: true });
        await expect(
          getVoiceTranscriptionSettings(
            { clinicId: fixture.clinicId, identityId: fixture.ownerId },
            drizzleVoiceTranscriptionSettingsStore,
          ),
        ).resolves.toEqual({ enabled: true });

        await expect(
          getNoShowPolicy(
            { clinicId: fixture.clinicId, identityId: fixture.doctorId },
            drizzleNoShowPolicyStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");
        await expect(
          setNoShowPolicy(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.doctorId,
              policy: "alert",
            },
            drizzleNoShowPolicyStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");
        await expect(
          getEscalationNotificationSettings(
            { clinicId: fixture.clinicId, identityId: fixture.doctorId },
            drizzleEscalationNotificationSettingsStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");
        await expect(
          setEscalationNotificationSettings(
            {
              clinicId: fixture.clinicId,
              enabled: false,
              identityId: fixture.secretaryId,
              secretaryPhoneE164: null,
            },
            drizzleEscalationNotificationSettingsStore,
          ),
        ).rejects.toBeInstanceOf(EscalationNotificationSettingsAccessError);
        await expect(
          getVoiceTranscriptionSettings(
            { clinicId: fixture.clinicId, identityId: fixture.secretaryId },
            drizzleVoiceTranscriptionSettingsStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");
        await expect(
          setVoiceTranscriptionSettings(
            {
              clinicId: fixture.clinicId,
              enabled: false,
              identityId: fixture.secretaryId,
            },
            drizzleVoiceTranscriptionSettingsStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");

        const audits = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerId },
          (transaction) =>
            transaction.query.configurationAuditEvents.findMany({
              where: eq(configurationAuditEvents.clinicId, fixture.clinicId),
            }),
        );
        expect(audits).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "whatsapp-no-show-policy-updated",
              afterValues: { noShowPolicy: "cancel-after-third-reminder" },
              beforeValues: { noShowPolicy: "alert" },
              entity: "whatsapp-operational-policies",
              entityId: fixture.clinicId,
            }),
            expect.objectContaining({
              action: "whatsapp-escalation-notifications-updated",
              afterValues: {
                enabled: "true",
                secretaryPhoneE164: "+50370000000",
              },
              beforeValues: { enabled: "false", secretaryPhoneE164: null },
              entity: "whatsapp-operational-policies",
              entityId: fixture.clinicId,
            }),
            expect.objectContaining({
              action: "whatsapp-voice-transcription-updated",
              afterValues: { enabled: "true" },
              beforeValues: { enabled: "false" },
              entity: "whatsapp-operational-policies",
              entityId: fixture.clinicId,
            }),
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const ids = {
    doctor: `apo-64-doctor-${suffix}`,
    owner: `apo-64-owner-${suffix}`,
    secretary: `apo-64-secretary-${suffix}`,
    superadmin: `apo-64-superadmin-${suffix}`,
  };

  await db.insert(identities).values(
    Object.values(ids).map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  await db.insert(apoloSuperadmins).values({ identityId: ids.superadmin });

  const clinicId = await inSuperadminTransaction(
    ids.superadmin,
    async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({ name: `Clínica APO-64 ${suffix}` })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("Falta la Clínica de prueba");
      await transaction.insert(clinicUsers).values([
        { clinicId: clinic.id, identityId: ids.owner, role: "owner" },
        { clinicId: clinic.id, identityId: ids.doctor, role: "doctor" },
        { clinicId: clinic.id, identityId: ids.secretary, role: "secretary" },
      ]);
      return clinic.id;
    },
  );

  return {
    clinicId,
    doctorId: ids.doctor,
    ownerId: ids.owner,
    secretaryId: ids.secretary,
    async cleanup() {
      await inSuperadminTransaction(ids.superadmin, async (transaction) => {
        await transaction
          .delete(configurationAuditEvents)
          .where(eq(configurationAuditEvents.clinicId, clinicId));
        await transaction.delete(clinics).where(eq(clinics.id, clinicId));
      });
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, ids.superadmin));
      await db
        .delete(identities)
        .where(inArray(identities.id, Object.values(ids)));
    },
  };
}
