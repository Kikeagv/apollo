import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import { createSyntheticClinic } from "../src/server/application/create-synthetic-clinic";
import { db } from "../src/server/db";
import { inSuperadminTransaction } from "../src/server/db/clinic-context";
import {
  apoloSuperadmins,
  clinics,
  identityAuditEvents,
  user as identities,
  verification,
} from "../src/server/db/schema";
import { drizzleSyntheticClinicRegistration } from "../src/server/db/synthetic-clinic-registration";

const e2eOtp = "246810";
const password = "Contraseña-segura-E2E";

test("el médico propietario activa, verifica su navegador y abre Panacea", async ({
  page,
}) => {
  const fixture = await createFixture();

  try {
    await page.goto(`/activar-invitacion?token=${fixture.invitationToken}`);
    await expect(
      page.getByRole("heading", { name: "Activar invitación" }),
    ).toBeVisible();

    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Confirmar contraseña").fill(password);
    await page.getByRole("button", { name: "Activar cuenta" }).click();
    await expect(
      page.getByText(
        "La cuenta se activó. Ya puede iniciar sesión con su correo y contraseña.",
      ),
    ).toBeVisible();

    await page.goto("/");
    await page.getByLabel("Correo").fill(fixture.ownerEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\?verificar=otp/);
    await expect(
      page.getByText("Enviamos un código de un solo uso a su correo."),
    ).toBeVisible();

    await page.getByLabel("Código de verificación").fill(e2eOtp);
    await page
      .getByRole("button", { name: "Verificar y abrir Panacea" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(fixture.clinicName)).toBeVisible();
    await expect(page.getByText("Esta es su Panacea vacía.")).toBeVisible();

    await page
      .getByRole("button", { name: "Registrar acción sintética" })
      .click();
    await expect(
      page.getByText("La acción clínica sintética quedó registrada."),
    ).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture() {
  const superadminId = `e2e-superadmin-${randomUUID()}`;
  const ownerEmail = `e2e-owner-${randomUUID()}@example.test`;
  const clinicName = `Clínica E2E ${randomUUID()}`;
  let clinicId: string | undefined;
  let invitationToken: string | undefined;

  await db.insert(identities).values({
    id: superadminId,
    name: "Superadmin sintético E2E",
    email: `${superadminId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });

  try {
    const clinic = await createSyntheticClinic(
      {
        actorIdentityId: superadminId,
        clinicName,
        owner: { email: ownerEmail, name: "Dra. Ana E2E" },
      },
      {
        registry: drizzleSyntheticClinicRegistration,
        async sendOwnerInvitation(invitation) {
          invitationToken = invitation.token;
        },
      },
    );
    clinicId = clinic.id;
    if (invitationToken === undefined) {
      throw new Error("Falta la invitación sintética para el E2E");
    }

    return {
      clinicName,
      invitationToken,
      ownerEmail,
      async cleanup() {
        const createdClinicId = clinicId;
        if (createdClinicId !== undefined) {
          await inSuperadminTransaction(superadminId, async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${createdClinicId}, true)`,
            );
            await transaction
              .delete(identityAuditEvents)
              .where(eq(identityAuditEvents.clinicId, createdClinicId));
            await transaction
              .delete(clinics)
              .where(eq(clinics.id, createdClinicId));
          });
        }
        await db
          .delete(verification)
          .where(eq(verification.identifier, `sign-in-otp-${ownerEmail}`));
        await db.delete(identities).where(eq(identities.email, ownerEmail));
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminId));
        await db.delete(identities).where(eq(identities.id, superadminId));
      },
    };
  } catch (error) {
    const createdClinicId = clinicId;
    if (createdClinicId !== undefined) {
      await inSuperadminTransaction(superadminId, async (transaction) => {
        await transaction.execute(
          sql`select set_config('app.clinic_id', ${createdClinicId}, true)`,
        );
        await transaction
          .delete(identityAuditEvents)
          .where(eq(identityAuditEvents.clinicId, createdClinicId));
        await transaction
          .delete(clinics)
          .where(eq(clinics.id, createdClinicId));
      });
    }
    await db
      .delete(apoloSuperadmins)
      .where(eq(apoloSuperadmins.identityId, superadminId));
    await db.delete(identities).where(eq(identities.id, superadminId));
    throw error;
  }
}
