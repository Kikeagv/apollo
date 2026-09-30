import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import { createSyntheticClinic } from "../src/server/application/create-synthetic-clinic";
import { db } from "../src/server/db";
import { inSuperadminTransaction } from "../src/server/db/clinic-context";
import {
  apoloSuperadmins,
  appointmentEvents,
  appointments,
  clinics,
  configurationAuditEvents,
  conversationEscalations,
  identityAuditEvents,
  user as identities,
  verification,
  whatsappOnboardingAuditEvents,
} from "../src/server/db/schema";
import { drizzleSyntheticClinicRegistration } from "../src/server/db/synthetic-clinic-registration";

const password = "Contraseña-segura-E2E";
const otp = "246810";
test.setTimeout(60_000);

test("Apolo registra una Clínica y envía el enlace sin ejecutar el preflight", async ({
  page,
}) => {
  const fixture = await createFixture();
  const clinicName = `Clínica APO-113 E2E ${randomUUID()}`;
  let ownerIdentityId: string | undefined;
  let createdClinicId: string | undefined;

  try {
    await activateOwnerAccount(page, fixture);
    const owner = await db.query.user.findFirst({
      columns: { id: true },
      where: eq(identities.email, fixture.ownerEmail),
    });
    if (owner === undefined) throw new Error("Falta el propietario E2E");
    ownerIdentityId = owner.id;
    await db.insert(apoloSuperadmins).values({ identityId: ownerIdentityId });
    await signInOwnerAsSuperadmin(page, fixture.ownerEmail);

    await page.goto("/apolo");
    await waitForInteractivity(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Supervisión" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Alta comercial o sintética" })
      .click();
    await expect(page).toHaveURL(/\/apolo\/alta/);
    await waitForInteractivity(page);
    await page.getByLabel("Nombre de la Clínica").fill(clinicName);
    await page.getByLabel("Médico propietario").fill("Dra. Elena APO-113");
    await page
      .getByLabel("Correo del propietario")
      .fill("owner.apo113@example.test");
    await expect(page.getByLabel("Nombre de la Clínica")).toHaveValue(
      clinicName,
    );
    await expect(
      page.getByRole("button", { name: "Crear Clínica" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Crear Clínica" }).click();
    await expect(
      page.getByText(`Clínica ${clinicName} creada correctamente.`),
    ).toBeVisible();
    const createdClinic = await db.query.clinics.findFirst({
      columns: { id: true },
      where: eq(clinics.name, clinicName),
    });
    if (createdClinic === undefined)
      throw new Error("Falta la Clínica APO-113");
    createdClinicId = createdClinic.id;

    await page
      .getByRole("link", { name: "Continuar con activación de WhatsApp" })
      .click();
    await waitForInteractivity(page);
    const journey = page
      .locator('[data-clinic-activation-journey="true"]')
      .last();
    await expect(
      journey.getByText("Registrar la Clínica y asociar a su propietario"),
    ).toBeVisible();
    await journey
      .getByRole("button", { name: "Enviar enlace al propietario" })
      .click();
    await expect(
      journey.getByText(
        "Enlace de configuración enviado a owner.apo113@example.test.",
      ),
    ).toBeVisible();
    await expect(
      journey.getByText(
        "Pendiente de la prueba real con un Contacto controlado.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      journey.getByText("Roundtrip entrante: Pendiente", { exact: true }),
    ).toBeVisible();
    await expect(
      journey.getByText(
        "Aún no hay una ejecución real con un Contacto controlado. Un preflight no cuenta como roundtrip.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      journey.getByText("Inicio con plantilla y entrega: Pendiente.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      journey.getByText("Evidencia aún no registrada.", { exact: true }),
    ).toHaveCount(2);
    await expect(
      journey.getByText(
        "La Clínica no se marca lista para tráfico real hasta completar la prueba de plantilla.",
      ),
    ).toBeVisible();
  } finally {
    await page.close();
    if (ownerIdentityId !== undefined) {
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, ownerIdentityId));
    }
    const registeredClinic =
      createdClinicId === undefined
        ? await db.query.clinics.findFirst({
            columns: { id: true },
            where: eq(clinics.name, clinicName),
          })
        : undefined;
    for (const clinicId of [
      createdClinicId ?? registeredClinic?.id,
      fixture.seedClinicId,
    ]) {
      if (clinicId !== undefined)
        await cleanupClinic(fixture.superadminId, clinicId);
    }
    await db
      .delete(verification)
      .where(eq(verification.identifier, `sign-in-otp-${fixture.ownerEmail}`));
    await db.delete(identities).where(eq(identities.email, fixture.ownerEmail));
    await fixture.cleanup();
  }
});

async function activateOwnerAccount(
  page: Page,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  await page.goto(`/activar-invitacion?token=${fixture.invitationToken}`);
  await waitForInteractivity(page);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña").fill(password);
  await page.getByRole("button", { name: "Activar cuenta" }).click();
  await expect(page).toHaveURL(/\?next=/);
}

async function signInOwnerAsSuperadmin(page: Page, ownerEmail: string) {
  await page.goto("/");
  await waitForInteractivity(page);
  await page.getByLabel("Correo").fill(ownerEmail);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\?verificar=otp/);
  await page.getByLabel("Código de verificación").fill(otp);
  await page.getByRole("button", { name: "Verificar y abrir Praxia" }).click();
  await expect(page).toHaveURL(/\/apolo$/);
}

async function waitForInteractivity(page: Page) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-panacea-interactive",
    "true",
  );
}

async function cleanupClinic(actorIdentityId: string, clinicId: string) {
  await inSuperadminTransaction(actorIdentityId, async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.clinic_id', ${clinicId}, true)`,
    );
    await transaction
      .delete(identityAuditEvents)
      .where(eq(identityAuditEvents.clinicId, clinicId));
    await transaction
      .delete(configurationAuditEvents)
      .where(eq(configurationAuditEvents.clinicId, clinicId));
    await transaction
      .delete(appointmentEvents)
      .where(eq(appointmentEvents.clinicId, clinicId));
    await transaction
      .delete(appointments)
      .where(eq(appointments.clinicId, clinicId));
    await transaction
      .delete(conversationEscalations)
      .where(eq(conversationEscalations.clinicId, clinicId));
    await transaction
      .delete(whatsappOnboardingAuditEvents)
      .where(eq(whatsappOnboardingAuditEvents.clinicId, clinicId));
    await transaction.delete(clinics).where(eq(clinics.id, clinicId));
  });
}

async function createFixture() {
  const superadminId = `e2e-apo113-admin-${randomUUID()}`;
  const ownerEmail = `e2e-apo113-owner-${randomUUID()}@example.test`;
  let invitationToken: string | undefined;
  await db.insert(identities).values({
    id: superadminId,
    name: "Superadmin sintético APO-113",
    email: `${superadminId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });

  try {
    const seedClinic = await createSyntheticClinic(
      {
        actorIdentityId: superadminId,
        clinicName: `Clínica APO-113 seed ${randomUUID()}`,
        owner: { email: ownerEmail, name: "Dra. Elena APO-113" },
      },
      {
        registry: drizzleSyntheticClinicRegistration,
        async sendOwnerInvitation(invitation) {
          invitationToken = invitation.token;
        },
      },
    );
    if (invitationToken === undefined) {
      throw new Error("Falta la invitación sintética APO-113");
    }

    return {
      invitationToken,
      ownerEmail,
      seedClinicId: seedClinic.id,
      superadminId,
      async cleanup() {
        const owner = await db.query.user.findFirst({
          columns: { id: true },
          where: eq(identities.email, ownerEmail),
        });
        if (owner !== undefined) {
          await db
            .delete(apoloSuperadmins)
            .where(eq(apoloSuperadmins.identityId, owner.id));
          await db
            .delete(verification)
            .where(eq(verification.identifier, `sign-in-otp-${ownerEmail}`));
          await db.delete(identities).where(eq(identities.id, owner.id));
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminId));
        await db.delete(identities).where(eq(identities.id, superadminId));
      },
    };
  } catch (error) {
    await db
      .delete(apoloSuperadmins)
      .where(eq(apoloSuperadmins.identityId, superadminId));
    await db.delete(identities).where(eq(identities.id, superadminId));
    throw error;
  }
}
