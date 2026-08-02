import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { type createTRPCContext } from "~/server/api/trpc";
import { hashOpaqueAccessToken } from "~/server/application/clinic-access";
import { db } from "~/server/db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import {
  apoloSuperadmins,
  clinicSessions,
  clinicUsers,
  clinics,
  identityAuditEvents,
  patients,
  trustedClinicDevices,
  user as identities,
} from "~/server/db/schema";

describe("acción clínica sintética aislada", () => {
  it("Panacea registra una acción en su Clínica y RLS bloquea lectura y mutación desde otra Clínica", async () => {
    const fixture = await createIsolationFixture();
    const reader = await createRestrictedClinicalConnection();

    try {
      const action =
        await panaceaCaller(fixture).panacea.performSyntheticClinicalAction();

      const [createdPatient] = await inClinicTransaction(
        fixture.aurora,
        (transaction) =>
          transaction
            .select({ id: patients.id, name: patients.name })
            .from(patients)
            .where(eq(patients.id, action.patientId)),
      );
      expect(createdPatient).toBeDefined();

      const audit = await inClinicTransaction(fixture.aurora, (transaction) =>
        transaction.query.identityAuditEvents.findMany({
          where: and(
            eq(identityAuditEvents.clinicId, fixture.aurora.clinicId),
            eq(
              identityAuditEvents.action,
              "synthetic-clinical-action-performed",
            ),
          ),
        }),
      );
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "synthetic-clinical-action-performed",
            actorIdentityId: fixture.aurora.identityId,
            clinicId: fixture.aurora.clinicId,
            result: "succeeded",
          }),
        ]),
      );
      expect(JSON.stringify(audit)).not.toContain(createdPatient?.name ?? "");
      expect(audit.flatMap(Object.keys)).not.toContain("patientContent");

      await reader.begin(async (transaction) => {
        const [connection] = await transaction<
          [
            {
              bypassesRls: boolean;
              isSuperuser: boolean;
              role: string;
              tableOwner: string;
            },
          ]
        >`
            select
              current_user as role,
              (select rolsuper from pg_roles where rolname = current_user) as "isSuperuser",
              (select rolbypassrls from pg_roles where rolname = current_user) as "bypassesRls",
              (
                select relowner::regrole::text
                from pg_class
                where oid = 'public.pg-drizzle_patient'::regclass
              ) as "tableOwner"
          `;
        expect(connection).toMatchObject({
          bypassesRls: false,
          isSuperuser: false,
        });
        expect(connection?.role).not.toBe(connection?.tableOwner);

        await transaction`select set_config('app.identity_id', ${fixture.cedro.identityId}, true)`;
        await transaction`select set_config('app.clinic_id', ${fixture.cedro.clinicId}, true)`;

        const read = await transaction<[{ id: string }?]>`
            select id from "pg-drizzle_patient" where id = ${action.patientId}
          `;
        const mutation = await transaction<[{ id: string }?]>`
            update "pg-drizzle_patient"
            set name = 'Paciente sintético mutado desde Clínica Cedro'
            where id = ${action.patientId}
            returning id
          `;

        expect(read).toEqual([]);
        expect(mutation).toEqual([]);
      });

      const [patientAfterAttempt] = await inClinicTransaction(
        fixture.aurora,
        (transaction) =>
          transaction
            .select({ name: patients.name })
            .from(patients)
            .where(eq(patients.id, action.patientId)),
      );
      expect(patientAfterAttempt).toEqual({ name: createdPatient?.name });
    } finally {
      await reader.close();
      await fixture.cleanup();
    }
  });
});

async function createIsolationFixture() {
  const superadminId = `apo-30-superadmin-${randomUUID()}`;
  const aurora = createClinicalIdentity("aurora");
  const cedro = createClinicalIdentity("cedro");

  await db.insert(identities).values([
    {
      id: superadminId,
      name: "Superadmin sintético APO-30",
      email: `${superadminId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...[aurora, cedro].map((identity) => ({
      id: identity.identityId,
      name: `Propietario sintético ${identity.label} APO-30`,
      email: `${identity.identityId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  ]);
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });

  try {
    for (const clinicalIdentity of [aurora, cedro]) {
      const [clinic] = await inSuperadminTransaction(
        superadminId,
        (transaction) =>
          transaction
            .insert(clinics)
            .values({
              isSynthetic: true,
              name: `Clínica ${clinicalIdentity.label} sintética APO-30`,
            })
            .returning({ id: clinics.id }),
      );
      if (clinic === undefined)
        throw new Error("No se creó la Clínica sintética");
      clinicalIdentity.clinicId = clinic.id;

      await inSuperadminTransaction(superadminId, async (transaction) => {
        await transaction.execute(
          sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
        );
        await transaction.insert(clinicUsers).values({
          clinicId: clinic.id,
          identityId: clinicalIdentity.identityId,
          role: "owner",
        });
      });
    }

    const trustedDeviceToken = `dispositivo-apo-30-${randomUUID()}`;
    const clinicSessionToken = `sesion-apo-30-${randomUUID()}`;
    await db.insert(trustedClinicDevices).values({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      identityId: aurora.identityId,
      tokenHash: hashOpaqueAccessToken(trustedDeviceToken),
    });
    await db.insert(clinicSessions).values({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      identityId: aurora.identityId,
      tokenHash: hashOpaqueAccessToken(clinicSessionToken),
    });

    return {
      aurora: requireClinic(aurora),
      cedro: requireClinic(cedro),
      clinicSessionToken,
      trustedDeviceToken,
      async cleanup() {
        for (const clinicalIdentity of [aurora, cedro]) {
          const clinicId = clinicalIdentity.clinicId;
          if (clinicId === undefined) continue;
          await inSuperadminTransaction(superadminId, async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${clinicId}, true)`,
            );
            await transaction
              .delete(identityAuditEvents)
              .where(eq(identityAuditEvents.clinicId, clinicId));
            await transaction.delete(clinics).where(eq(clinics.id, clinicId));
          });
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminId));
        await db.delete(identities).where(eq(identities.id, superadminId));
        await db
          .delete(trustedClinicDevices)
          .where(eq(trustedClinicDevices.identityId, aurora.identityId));
        await db
          .delete(clinicSessions)
          .where(eq(clinicSessions.identityId, aurora.identityId));
        await db.delete(identities).where(eq(identities.id, aurora.identityId));
        await db.delete(identities).where(eq(identities.id, cedro.identityId));
      },
    };
  } catch (error) {
    await db
      .delete(apoloSuperadmins)
      .where(eq(apoloSuperadmins.identityId, superadminId));
    await db.delete(identities).where(eq(identities.id, superadminId));
    await db.delete(identities).where(eq(identities.id, aurora.identityId));
    await db.delete(identities).where(eq(identities.id, cedro.identityId));
    throw error;
  }
}

function panaceaCaller(
  fixture: Awaited<ReturnType<typeof createIsolationFixture>>,
) {
  const headers = new Headers({
    cookie: `panacea-trusted-device=${fixture.trustedDeviceToken}; panacea-clinic-session=${fixture.clinicSessionToken}`,
  });
  const session = {
    user: { id: fixture.aurora.identityId },
  } as NonNullable<Awaited<ReturnType<typeof createTRPCContext>>["session"]>;

  return createCaller({ db, headers, session });
}

function createClinicalIdentity(label: string) {
  return {
    clinicId: undefined as string | undefined,
    identityId: `apo-30-${label}-${randomUUID()}`,
    label,
  };
}

function requireClinic(identity: ReturnType<typeof createClinicalIdentity>) {
  if (identity.clinicId === undefined) {
    throw new Error("Falta la Clínica sintética");
  }
  return { clinicId: identity.clinicId, identityId: identity.identityId };
}

async function createRestrictedClinicalConnection() {
  const role = `apo_30_rls_${randomUUID().replaceAll("-", "")}`;
  const password = randomBytes(24).toString("hex");
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });

  await admin.unsafe(`create role ${role} login password '${password}'`);
  await admin.unsafe(`grant panacea_clinical_access to ${role}`);

  const url = new URL(process.env.DATABASE_URL!);
  url.username = role;
  url.password = password;
  const connection = postgres(url.toString(), { max: 1 });

  return {
    begin: connection.begin.bind(connection),
    async close() {
      await connection.end();
      await admin.unsafe(`drop role ${role}`);
      await admin.end();
    },
  };
}
