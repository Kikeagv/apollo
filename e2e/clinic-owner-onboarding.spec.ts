import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, isNull, sql } from "drizzle-orm";

import { createSyntheticClinic } from "../src/server/application/create-synthetic-clinic";
import { inviteAdditionalDoctor } from "../src/server/application/doctor-invitations";
import {
  configureEffectiveSchedule,
  createAvailabilityBlock,
} from "../src/server/application/availability";
import { addServiceOffer } from "../src/server/application/service-catalog";
import { db } from "../src/server/db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../src/server/db/clinic-context";
import {
  apoloSuperadmins,
  appointmentEvents,
  appointments,
  clinics,
  configurationAuditEvents,
  clinicSupportSessions,
  doctors,
  identityAuditEvents,
  services,
  temporaryReservations,
  user as identities,
  verification,
} from "../src/server/db/schema";
import { drizzleAvailabilityStore } from "../src/server/db/availability-store";
import { drizzleDoctorInvitationStore } from "../src/server/db/doctor-invitation-store";
import { drizzleServiceCatalogStore } from "../src/server/db/service-catalog-store";
import { drizzleSyntheticClinicRegistration } from "../src/server/db/synthetic-clinic-registration";

const e2eOtp = "246810";
const password = "Contraseña-segura-E2E";

test.setTimeout(60_000);

test("el médico propietario activa, verifica su navegador y abre Panacea", async ({
  page,
}) => {
  const fixture = await createFixture();

  try {
    await page.goto(`/activar-invitacion?token=${fixture.invitationToken}`);
    await waitForPanaceaInteractivity(page);
    await expect(
      page.getByRole("heading", { name: "Activar invitación" }),
    ).toBeVisible();

    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Confirmar contraseña").fill(password);
    await page.getByRole("button", { name: "Activar cuenta" }).click();
    await expect(
      page.getByText(
        "La cuenta se activó. En unos segundos la llevaremos al inicio de sesión.",
      ),
    ).toBeVisible();

    await page.goto("/");
    await waitForPanaceaInteractivity(page);
    await expectNoAccessibilityViolations(page, 'form[aria-busy="false"]');
    await page.getByLabel("Correo").fill(fixture.ownerEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\?verificar=otp/);
    await expect(
      page.getByText("Enviamos un código de un solo uso a su correo."),
    ).toBeVisible();
    await waitForPanaceaInteractivity(page);

    await page.getByLabel("Código de verificación").fill(e2eOtp);
    await page
      .getByRole("button", { name: "Verificar y abrir Praxia" })
      .click();
    await expect(page).toHaveURL(/\/calendario$/);
    await expect(page.getByText(fixture.clinicName)).toBeVisible();
    await expect(page.getByText("Clínica", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendario" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Pacientes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Pendientes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Configuración", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Fichas administrativas" }),
    ).not.toBeVisible();
    await expect(page.getByText("Médico propietario")).toBeVisible();
    await expect(page.getByLabel("Sesión de clínica activa")).toHaveCount(0);
    await page.getByRole("button", { name: /Cuenta de/ }).click();
    const accountMenu = page.getByRole("menu");
    await expect(accountMenu).toBeVisible();
    await expect(
      accountMenu.getByText("Sesión de clínica activa", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(accountMenu).not.toBeVisible();
    await expectNoAccessibilityViolations(page, "[data-sidebar=sidebar]");
    await expectNoAccessibilityViolations(page, "[data-sidebar=inset]");
    await waitForPanaceaInteractivity(page);

    await page.getByRole("link", { name: "Pacientes", exact: true }).click();
    await expect(page).toHaveURL(/\/pacientes$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pacientes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Fichas administrativas" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page, "[data-sidebar=inset]");

    await page.getByRole("link", { name: "Pendientes", exact: true }).click();
    await expect(page).toHaveURL(/\/pendientes$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pendientes" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page, "[data-sidebar=inset]");

    await page
      .getByRole("link", { name: "Configuración", exact: true })
      .click();
    await expect(page).toHaveURL(/\/configuracion$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Configuración" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page, "[data-sidebar=inset]");

    await page.getByRole("link", { name: "Calendario", exact: true }).click();
    await expect(page).toHaveURL(/\/calendario$/);
    await page.getByRole("button", { name: "Colapsar navegación" }).click();
    await expect(
      page.locator('[data-sidebar-state="collapsed"]'),
    ).toBeVisible();
    await expect(page.locator('a[title="Pacientes"]')).toBeVisible();
    await page.getByRole("button", { name: "Expandir navegación" }).click();

    await page.setViewportSize({ height: 844, width: 390 });
    await expect(
      page.getByRole("button", { name: "Abrir navegación" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("link", {
        name: "Configuración",
        exact: true,
      }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Abrir navegación" }),
    ).toBeFocused();
    await page.setViewportSize({ height: 720, width: 1280 });

    await page.goto("/technical/comprobacion-clinica");
    await waitForPanaceaInteractivity(page);
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

test("Pacientes completa el alta Paciente-primero y reutiliza el Contacto por teléfono", async ({
  page,
}) => {
  const fixture = await createFixture();
  const drawerViewportErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("<Drawer.Popup> expected to be rendered within")
    ) {
      drawerViewportErrors.push(message.text());
    }
  });

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    await page.goto("/pacientes");
    await waitForPanaceaInteractivity(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pacientes" }),
    ).toBeVisible();
    await expect(
      page.getByText("No hay Pacientes que coincidan con la búsqueda."),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Crear Ficha incompleta", exact: true })
      .click();
    const incompleteDialog = page.getByRole("dialog", {
      name: "Crear Ficha de Paciente incompleta",
    });
    await expect(
      incompleteDialog.getByLabel("Nombres del Paciente"),
    ).toBeVisible();
    await expect(
      incompleteDialog.getByLabel("Apellidos del Paciente"),
    ).toBeVisible();
    await expect(
      incompleteDialog.getByLabel("Nombre del Paciente"),
    ).toHaveCount(0);
    await incompleteDialog.getByRole("button", { name: "Cancelar" }).click();

    await page
      .getByRole("button", { name: "Nuevo Paciente", exact: true })
      .click();
    const firstDialog = page.getByRole("dialog", { name: "Nuevo Paciente" });
    await expectNoAccessibilityViolations(page, '[role="dialog"]', {
      disableRules: ["color-contrast"],
    });
    await firstDialog.getByLabel("Nombres del Paciente").fill("Lucía");
    await firstDialog.getByLabel("Apellidos del Paciente").fill("E2E");
    await firstDialog.getByLabel("Fecha de nacimiento").fill("1990-04-02");
    await expect(
      firstDialog.getByText("Contacto inicial", { exact: true }),
    ).toHaveCount(0);
    await expect(
      firstDialog.getByText(/El Contacto identifica al titular/),
    ).toHaveCount(0);
    await expect(firstDialog.getByLabel("Nombre del Contacto")).toHaveCount(0);
    await expect(firstDialog.getByLabel("Nombre del Tutor")).toHaveCount(0);
    await firstDialog.getByLabel("Teléfono").fill("+50371234567");
    await firstDialog
      .getByRole("button", { name: "Crear Paciente", exact: true })
      .click();
    await expect(page).toHaveURL(/\/pacientes\?patient=/);
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Lucía E2E", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("region", { name: "Contactos y Vínculos" })
        .getByText("Lucía E2E", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Contactos y Vínculos" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByLabel("Tipo de Vínculo")
        .getByRole("option", { name: "Tutor", exact: true }),
    ).toHaveCount(0);
    expect(drawerViewportErrors).toEqual([]);
    await expectNoAccessibilityViolations(page, "[data-sidebar=inset]");

    await page.getByRole("button", { name: "Cerrar panel" }).click();
    await page
      .getByRole("button", { name: "Nuevo Paciente", exact: true })
      .click();
    const secondDialog = page.getByRole("dialog", { name: "Nuevo Paciente" });
    await secondDialog.getByLabel("Nombres del Paciente").fill("Mateo");
    await secondDialog.getByLabel("Apellidos del Paciente").fill("E2E");
    await secondDialog.getByLabel("Fecha de nacimiento").fill("2015-08-11");
    await secondDialog.getByLabel("El Paciente es menor de edad").check();
    await secondDialog.getByLabel("Teléfono").fill("+503 7123-4567");
    await secondDialog.getByLabel("Nombre del Tutor").fill("Lucía E2E");
    await secondDialog.getByLabel("DUI del Tutor").fill("12345678-9");
    await expect(
      secondDialog.getByText("Contacto existente encontrado"),
    ).toBeVisible();
    await secondDialog
      .getByRole("button", { name: "Reutilizar Contacto" })
      .click();
    await secondDialog
      .getByRole("button", { name: "Crear Paciente", exact: true })
      .click();
    await expect(
      page.getByText("Contacto existente reutilizado."),
    ).toBeVisible();
    await expect(page.getByText("Mateo E2E", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("region", { name: "Contactos y Vínculos" })
        .getByText("Tutor", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByText("DUI: 12345678-9 · Tutela pendiente de verificación", {
          exact: true,
        }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cerrar panel" }).click();
    await page.getByLabel("Buscar por").selectOption("contacts");
    await page.getByTestId("patient-directory-search").fill("Lucía E2E");
    await expect(
      page.getByRole("heading", { name: "Contactos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Lucía E2E", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mateo E2E", exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("el Calendario muestra una agenda temporal y abre la nueva Cita en un modal", async ({
  page,
}) => {
  const fixture = await createFixture();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    await page.goto("/calendario?date=2026-09-16");
    await waitForPanaceaInteractivity(page);
    await expect(
      page.getByRole("status", { name: "Comprobando sesiones de soporte…" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document.querySelector(
            'main[data-sidebar="inset"] > header',
          );
          const heading = document.querySelector(
            'main[data-sidebar="inset"] h1',
          );
          if (header === null || heading === null) {
            return Number.POSITIVE_INFINITY;
          }
          return (
            heading.getBoundingClientRect().top -
            header.getBoundingClientRect().bottom
          );
        }),
      )
      .toBeLessThan(40);

    const sidebar = page.locator('aside[data-sidebar="sidebar"]');
    await expect(sidebar).toBeVisible();
    await page.setViewportSize({ height: 400, width: 1280 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight > window.innerHeight,
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      window.scrollTo({ behavior: "instant", top: document.body.scrollHeight });
    });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await sidebar.boundingBox())?.y ?? -1)
      .toBe(0);
    await page.evaluate(() => window.scrollTo({ behavior: "instant", top: 0 }));
    await page.setViewportSize({ height: 720, width: 1280 });

    const calendar = calendarSection(page);
    await expect(
      calendar.getByText("13 sept 2026 — 19 sept 2026", { exact: true }),
    ).toBeVisible();
    await calendar.getByRole("button", { name: "Día" }).click();
    await expect(calendar.locator('[data-calendar-view="day"]')).toBeVisible();
    await expect(
      calendar.getByText("16 sept 2026", { exact: true }),
    ).toBeVisible();
    await calendar.getByRole("button", { name: "Semana" }).click();
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible();
    await expect(
      calendar.getByText("13 sept 2026 — 19 sept 2026", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendario" }),
    ).toBeVisible();
    await expect(
      calendar.getByRole("heading", { level: 2, name: "Calendario" }),
    ).toHaveCount(0);
    await expect(
      calendar.getByRole("heading", { level: 3, name: "Agenda de la Clínica" }),
    ).toHaveCount(0);
    await expect(
      calendar.getByRole("toolbar", {
        name: "Navegación y acciones del Calendario",
      }),
    ).toBeVisible();
    await expect(
      calendar.getByRole("group", {
        name: "Filtros y vista del Calendario",
      }),
    ).toBeVisible();
    await expect(page.getByText("Panacea", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Operación diaria de agenda", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Consulte la semana completa, cambie a la vista diaria y gestione la Operación diaria de agenda.",
        { exact: true },
      ),
    ).toHaveCount(0);

    await expect(
      calendar.getByRole("button", { name: "Nueva Cita manual", exact: true }),
    ).toBeVisible();
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible();
    await expect(calendar.locator('[data-calendar-day="true"]')).toHaveCount(7);
    await expect(
      calendar.locator('[data-calendar-grid-hour="true"]'),
    ).not.toHaveCount(0);

    const emptyCalendarDay = calendar
      .getByRole("button", {
        name: /Crear Cita en .* desde la cuadrícula temporal/,
      })
      .first();
    await emptyCalendarDay.press("Enter");
    const contextualAppointmentDialog = page.getByRole("dialog", {
      name: "Nueva Cita manual",
    });
    await expect(contextualAppointmentDialog).toBeVisible();
    await expect(
      contextualAppointmentDialog.locator('input[name="startsAt"]'),
    ).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    await contextualAppointmentDialog
      .getByRole("button", { name: "Cancelar" })
      .click();

    await calendar
      .getByRole("button", { name: "Nueva Cita manual", exact: true })
      .click();
    const appointmentDialog = page.getByRole("dialog", {
      name: "Nueva Cita manual",
    });
    await expect(appointmentDialog).toBeVisible();
    await expect(appointmentDialog.getByLabel("Paciente")).toBeVisible();
    await expect(
      appointmentDialog.getByLabel("Oferta de servicio"),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page, '[role="dialog"]', {
      disableRules: ["color-contrast"],
    });
    await expectNoAccessibilityViolations(page, '[data-calendar-view="week"]', {
      disableRules: ["color-contrast"],
    });

    await appointmentDialog
      .getByLabel("Enviar confirmación inmediata por WhatsApp")
      .check();
    await expect(
      appointmentDialog.getByRole("button", { name: "Cerrar" }),
    ).toHaveCount(0);
    await appointmentDialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(appointmentDialog).not.toBeVisible();

    await calendar
      .getByRole("button", { name: "Nueva Cita manual", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Nueva Cita manual" })
        .getByLabel("Enviar confirmación inmediata por WhatsApp"),
    ).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(appointmentDialog).not.toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

async function expectNoAccessibilityViolations(
  page: Page,
  selector: string,
  options: { disableRules?: string[] } = {},
) {
  const scan = new AxeBuilder({ page }).include(selector);
  if (options.disableRules !== undefined) {
    scan.disableRules(options.disableRules);
  }
  const accessibilityScanResults = await scan.analyze();

  expect(accessibilityScanResults.violations).toEqual([]);
}

test("las rutas de Panacea conservan una carga segura sin JavaScript", async ({
  browser,
  page,
}) => {
  const fixture = await createFixture();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    const preHydrationContext = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    try {
      const preHydrationPage = await preHydrationContext.newPage();
      await preHydrationPage.goto("/configuracion/equipo");

      await expect(preHydrationPage).toHaveURL(/\/configuracion\/equipo$/);
      await expect(
        preHydrationPage.getByRole("status", { name: "Cargando Equipo" }),
      ).toBeVisible();
      await expect(
        preHydrationPage.getByRole("button", { name: "Guardar perfil" }),
      ).not.toBeAttached();
    } finally {
      await preHydrationContext.close();
    }
  } finally {
    await fixture.cleanup();
  }
});

test("el shell muestra el soporte activo y lo retira al vencer", async ({
  page,
}) => {
  const fixture = await createFixture();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    await inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
      transaction.insert(clinicSupportSessions).values({
        clinicId: fixture.clinicId(),
        expiresAt: new Date(Date.now() + 60_000),
        reason: "Revisar el alcance de soporte E2E",
        superadminIdentityId: fixture.superadminIdentityId,
      }),
    );
    await reloadPanacea(page);

    const supportAlert = page.locator('[data-support-session-alert="true"]');
    await expect(supportAlert).toContainText("Sesión de soporte activa");
    await expect(supportAlert).toContainText(
      "Revisar el alcance de soporte E2E",
    );
    await expect(supportAlert).toContainText("Accesos auditados: 0");
    await expectNoAccessibilityViolations(page, '[role="alert"]');

    await inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
      transaction
        .update(clinicSupportSessions)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(clinicSupportSessions.clinicId, fixture.clinicId())),
    );
    await reloadPanacea(page);
    await expect(supportAlert).not.toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("Panacea configura disponibilidad y protege la capacidad de Médicos", async ({
  browser,
  page,
}) => {
  const fixture = await createFixture();
  const consultationName = "Consulta E2E";
  const ownerName = "Dra. Ana E2E";
  const invitedDoctorName = "Dr. Bruno E2E";
  const careDate = nextClinicMonday();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );

    await goToPanaceaRoute(page, "/configuracion/equipo");
    const profile = section(page, "Configuración inicial");
    await profile.getByLabel("Nombre público").fill(ownerName);
    await profile
      .getByLabel("Especialidad principal")
      .fill("Medicina familiar");
    await profile.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(profile.getByText("Perfil de Médico guardado.")).toBeVisible();
    await reloadPanacea(page);

    await goToPanaceaRoute(page, "/configuracion/servicios");
    const catalog = section(page, "Catálogo de Servicios");
    const createServiceForm = catalog
      .getByRole("button", { name: "Crear Servicio" })
      .locator("..");
    await createServiceForm
      .locator('input[name="name"]')
      .fill(consultationName);
    await createServiceForm
      .locator('textarea[name="description"]')
      .fill("Consulta de prueba");
    await createServiceForm.locator('select[name="doctorId"]').selectOption({
      label: ownerName,
    });
    await createServiceForm.locator('input[name="priceUsd"]').fill("35.00");
    await createServiceForm.locator('input[name="durationMinutes"]').fill("30");
    await createServiceForm.locator('input[name="bufferMinutes"]').fill("0");
    await createServiceForm
      .getByRole("button", { name: "Crear Servicio" })
      .click();
    await expect(
      catalog.getByText(`Servicio ${consultationName} creado.`),
    ).toBeVisible();

    await saveSchedule(page, careDate, ownerName);
    await expectCareOptions(page, ownerName, consultationName, careDate, true);

    const ownerIdentityId = await test.step("obtiene el propietario", () =>
      fixture.ownerIdentityId());
    const invitation = await test.step("invita al Médico", () =>
      inviteDoctor({
        clinicId: fixture.clinicId(),
        ownerIdentityId,
        recipientEmail: fixture.invitedDoctorEmail,
        recipientName: invitedDoctorName,
      }));
    const invitedContext = await browser.newContext();
    try {
      const invitedPage = await invitedContext.newPage();
      await activateAndOpenPanacea(
        invitedPage,
        invitation.token,
        fixture.invitedDoctorEmail,
      );
      await reloadPanacea(page);
      await configureInvitedDoctor({
        clinicId: fixture.clinicId(),
        date: careDate,
        ownerIdentityId,
        serviceName: consultationName,
      });
      await reloadPanacea(page);
      await expectCareOptions(
        page,
        "Médico sin nombre público",
        consultationName,
        careDate,
        false,
      );

      await goToPanaceaRoute(invitedPage, "/configuracion");
      const invitedProfile = section(invitedPage, "Configuración inicial");
      await invitedProfile.getByLabel("Nombre público").fill(invitedDoctorName);
      await invitedProfile
        .getByLabel("Especialidad principal")
        .fill("Pediatría");
      await invitedProfile
        .getByRole("button", { name: "Guardar perfil" })
        .click();
      await expect(
        invitedProfile.getByText("Perfil de Médico guardado."),
      ).toBeVisible();
    } finally {
      await invitedContext.close();
    }

    await reloadPanacea(page);
    await expectCareOptions(
      page,
      invitedDoctorName,
      consultationName,
      careDate,
      true,
    );

    const [ownerDoctor, invitedDoctor] = await inClinicTransaction(
      { clinicId: fixture.clinicId(), identityId: ownerIdentityId },
      async (transaction) =>
        Promise.all([
          findDoctor(transaction, {
            clinicId: fixture.clinicId(),
            publicName: ownerName,
          }),
          findDoctor(transaction, {
            clinicId: fixture.clinicId(),
            publicName: invitedDoctorName,
          }),
        ]),
    );
    await Promise.all([
      createAvailabilityBlock(
        {
          clinicId: fixture.clinicId(),
          doctorId: ownerDoctor.id,
          endsAt: new Date(`${careDate}T08:45:00-06:00`),
          identityId: ownerIdentityId,
          privateLabel: "Capacitación de Ana",
          startsAt: new Date(`${careDate}T08:15:00-06:00`),
        },
        drizzleAvailabilityStore,
      ),
      createAvailabilityBlock(
        {
          clinicId: fixture.clinicId(),
          doctorId: invitedDoctor.id,
          endsAt: new Date(`${careDate}T09:45:00-06:00`),
          identityId: ownerIdentityId,
          privateLabel: "Capacitación de Bruno",
          startsAt: new Date(`${careDate}T09:15:00-06:00`),
        },
        drizzleAvailabilityStore,
      ),
    ]);
    await reloadPanacea(page);
    const calendar = calendarSection(page);
    const agendaList = calendar.locator('[data-calendar-list="true"]');
    await calendar.locator('input[type="date"]').fill(careDate);
    const anaBlock = agendaList.getByRole("button", {
      name: /Bloqueo.*Capacitación de Ana/,
    });
    const brunoBlock = agendaList.getByRole("button", {
      name: /Bloqueo.*Capacitación de Bruno/,
    });
    await expect(anaBlock).toBeVisible();
    await expect(brunoBlock).toBeVisible();
    await calendar.getByLabel("Médico").selectOption({ label: ownerName });
    await expect(anaBlock).toBeVisible();
    await expect(brunoBlock).not.toBeVisible();
    await calendar.getByRole("button", { name: "Día" }).click();
    await expect(anaBlock).toBeVisible();

    await createConfirmedAppointment({
      clinicId: fixture.clinicId(),
      date: careDate,
      ownerIdentityId,
      publicName: invitedDoctorName,
    });
    await goToPanaceaRoute(page, "/configuracion/servicios");
    const catalogAfterAppointment = section(page, "Catálogo de Servicios");
    const service = catalogAfterAppointment
      .locator("article")
      .filter({ hasText: consultationName });
    const invitedOffer = service
      .getByRole("form", { name: `Oferta de ${invitedDoctorName}` })
      .getByRole("button", { name: "Desactivar" });
    await invitedOffer.click();
    await expect(
      catalogAfterAppointment.getByText("Cita confirmada", { exact: false }),
    ).toBeVisible();
    await expect(invitedOffer).toBeVisible();
    await goToPanaceaRoute(page, "/configuracion/equipo");
    const doctorsSection = section(page, "Médicos");
    await doctorsSection
      .locator("li")
      .filter({ hasText: invitedDoctorName })
      .getByRole("button", { name: "Desactivar" })
      .click();
    await expect(
      doctorsSection.getByText("Cita confirmada", { exact: false }),
    ).toBeVisible();
    await expect(
      doctorsSection
        .getByText(`${invitedDoctorName} · Pediatría`, { exact: true })
        .locator(".."),
    ).toContainText("Activo");
    await clearConfirmedAppointments({
      clinicId: fixture.clinicId(),
      ownerIdentityId,
      publicName: invitedDoctorName,
    });
    await createTemporaryReservation({
      clinicId: fixture.clinicId(),
      date: careDate,
      ownerIdentityId,
      publicName: invitedDoctorName,
    });
    await doctorsSection
      .locator("li")
      .filter({ hasText: invitedDoctorName })
      .getByRole("button", { name: "Desactivar" })
      .click();
    await expect(
      doctorsSection.getByText("Reserva temporal activa", { exact: false }),
    ).toBeVisible();
    await expect(
      doctorsSection
        .getByText(`${invitedDoctorName} · Pediatría`, { exact: true })
        .locator(".."),
    ).toContainText("Activo");
    await clearTemporaryReservations({
      clinicId: fixture.clinicId(),
      ownerIdentityId,
      publicName: invitedDoctorName,
    });
    await doctorsSection
      .locator("li")
      .filter({ hasText: invitedDoctorName })
      .getByRole("button", { name: "Desactivar" })
      .click();
    await expect(
      doctorsSection.getByText(`Médico desactivado: ${invitedDoctorName}.`),
    ).toBeVisible();
    await expectCareOptions(
      page,
      invitedDoctorName,
      consultationName,
      careDate,
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("Panacea repite la nueva Cita sin navegación nativa", async ({ page }) => {
  const fixture = await createFixture();
  const doctorName = "Dra. Inés Inline";
  const serviceName = "Consulta inline";
  const careDate = nextClinicMonday();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );

    await configureCalendarScenario({
      careDate,
      doctorName,
      page,
      serviceDescription: "Consulta creada en el recorrido E2E",
      serviceName,
    });

    const calendar = calendarSection(page);
    const nativeNavigationsDuringAppointmentCreation: string[] = [];
    page.on("request", (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        nativeNavigationsDuringAppointmentCreation.push(request.url());
      }
    });

    for (const appointment of [
      {
        patientName: "Lucía Inline",
        phone: "+50371234567",
        startsAt: "08:00",
      },
      {
        patientName: "Mateo Inline",
        phone: "+50371234567",
        reuseExistingContact: true,
        startsAt: "08:30",
      },
    ]) {
      await registerInlinePatient(calendar, page, {
        ...appointment,
        careDate,
      });
      await expect(page.getByRole("dialog").getByLabel("Paciente")).toHaveValue(
        /.+/,
      );

      await createManualAppointmentInCalendar(calendar, page, {
        careDate,
        doctorName,
        serviceName,
        startsAt: appointment.startsAt,
      });
      await expect(
        calendar.getByRole("heading", { name: "Detalle de la Cita" }),
      ).toBeVisible();
      await expect(
        calendar.getByRole("link", { name: "Abrir ficha del Paciente" }),
      ).toBeVisible();
      await expect(
        calendar.getByRole("link", { name: "Abrir ficha del Contacto" }),
      ).toBeVisible();
      expect(nativeNavigationsDuringAppointmentCreation).toEqual([]);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("el Calendario cancela una Cita activa y conserva su historial", async ({
  page,
}) => {
  const fixture = await createFixture();
  const doctorName = "Dra. Camila Cancelación";
  const serviceName = "Consulta cancelable";
  const patientName = "Paciente con historial";
  const careDate = nextClinicMonday();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    await configureCalendarScenario({
      careDate,
      doctorName,
      page,
      serviceDescription: "Consulta para cancelar desde el Calendario",
      serviceName,
    });

    const calendar = calendarSection(page);
    await registerInlinePatient(calendar, page, {
      careDate,
      patientName,
    });
    await createManualAppointmentInCalendar(calendar, page, {
      careDate,
      doctorName,
      serviceName,
      startsAt: "08:00",
    });

    const agendaList = calendar.locator('[data-calendar-list="true"]');
    const activeAppointment = agendaList.getByRole("button", {
      name: new RegExp(`8:00.*${patientName}`),
    });
    await calendar.getByRole("button", { name: "Semana" }).click();
    await calendar.getByLabel("Médico").selectOption({ label: doctorName });
    await expect(activeAppointment).toBeVisible();
    await calendar.getByRole("button", { name: "Día" }).click();
    const activeDayAppointment = agendaList.getByRole("button", {
      name: new RegExp(`8:00.*${patientName}`),
    });
    await expect(activeDayAppointment).toBeVisible();

    await activeDayAppointment.click();
    const appointmentDetail = calendar
      .getByRole("heading", { name: "Detalle de la Cita" })
      .locator("xpath=../..");
    await appointmentDetail
      .getByRole("button", { name: "Cancelar Cita" })
      .click();
    const cancellationDialog = page.getByRole("alertdialog");
    await expect(cancellationDialog).toBeVisible();
    await cancellationDialog
      .getByRole("button", { name: "Confirmar cancelación" })
      .click();
    await expect(activeDayAppointment).not.toBeVisible();

    const cancelledAppointment = calendar
      .getByRole("heading", { name: "Citas canceladas" })
      .locator("xpath=../..")
      .getByRole("button", { name: new RegExp(patientName) });
    await cancelledAppointment.click();
    await expect(appointmentDetail).toContainText("Cancelada");
    await expect(appointmentDetail).toContainText("Cita manual creada");
    await expect(appointmentDetail).toContainText("Cita cancelada");
  } finally {
    await fixture.cleanup();
  }
});

test("el Calendario solo ofrece cancelar Citas manuales futuras", async ({
  page,
}) => {
  const fixture = await createFixture();
  const doctorName = "Dra. Inés Orígenes";
  const serviceName = "Consulta con orígenes";
  const patientName = "Paciente de orígenes";
  const careDate = nextClinicMonday();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    await configureCalendarScenario({
      careDate,
      doctorName,
      page,
      serviceDescription: "Consulta para distinguir el origen de la Cita",
      serviceName,
    });

    const calendar = calendarSection(page);
    await registerInlinePatient(calendar, page, {
      careDate,
      patientName,
    });
    await createManualAppointmentInCalendar(calendar, page, {
      careDate,
      doctorName,
      serviceName,
      startsAt: "08:00",
    });
    await expect(
      calendar.locator('[data-calendar-list="true"]').getByRole("button", {
        name: new RegExp(`8:00.*${patientName}`),
      }),
    ).toBeVisible();

    const ownerIdentityId = await fixture.ownerIdentityId();
    await inClinicTransaction(
      { clinicId: fixture.clinicId(), identityId: ownerIdentityId },
      async (transaction) => {
        const manualAppointment =
          await transaction.query.appointments.findFirst({
            columns: {
              actorClinicUserId: true,
              bufferMinutes: true,
              clinicId: true,
              doctorId: true,
              durationMinutes: true,
              patientId: true,
              priceUsd: true,
              serviceOfferId: true,
            },
            where: and(
              eq(appointments.clinicId, fixture.clinicId()),
              eq(appointments.startsAt, new Date(`${careDate}T08:00:00-06:00`)),
            ),
          });
        if (manualAppointment === undefined) {
          throw new Error("Falta la Cita manual E2E");
        }
        await transaction.insert(appointments).values({
          ...manualAppointment,
          endsAt: new Date(`${careDate}T09:10:00-06:00`),
          occupiedUntil: new Date(`${careDate}T09:10:00-06:00`),
          origin: "reservation",
          startsAt: new Date(`${careDate}T08:40:00-06:00`),
        });
      },
    );
    await reloadPanacea(page);
    await calendar.locator('input[type="date"]').fill(careDate);

    const agendaList = calendar.locator('[data-calendar-list="true"]');
    const manualAppointment = agendaList.getByRole("button", {
      name: new RegExp(`8:00.*${patientName}`),
    });
    await manualAppointment.click();
    const appointmentDetail = calendar
      .getByRole("heading", { name: "Detalle de la Cita" })
      .locator("xpath=../..");
    await expect(appointmentDetail).toContainText(patientName);
    await expect(
      appointmentDetail.getByRole("button", { name: "Cancelar Cita" }),
    ).toBeVisible();

    const reservationAppointment = agendaList.getByRole("button", {
      name: new RegExp(`8:40.*${patientName}`),
    });
    await reservationAppointment.click();
    await expect(appointmentDetail).toContainText(patientName);
    await expect(
      appointmentDetail.getByRole("button", { name: "Cancelar Cita" }),
    ).not.toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("el Calendario rechaza una Cita que se traslapa con capacidad ocupada", async ({
  page,
}) => {
  const fixture = await createFixture();
  const doctorName = "Dr. Tomás Capacidad";
  const serviceName = "Consulta sin traslape";
  const patientName = "Paciente sin traslape";
  const careDate = nextClinicMonday();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );
    await configureCalendarScenario({
      careDate,
      doctorName,
      page,
      serviceDescription: "Consulta para proteger la capacidad del Médico",
      serviceName,
    });

    const calendar = calendarSection(page);
    await registerInlinePatient(calendar, page, {
      careDate,
      patientName,
    });
    await createManualAppointmentInCalendar(calendar, page, {
      careDate,
      doctorName,
      serviceName,
      startsAt: "08:00",
    });
    await expect(
      calendar.locator('[data-calendar-list="true"]').getByRole("button", {
        name: new RegExp(`8:00.*${patientName}`),
      }),
    ).toBeVisible();

    await createManualAppointmentInCalendar(calendar, page, {
      careDate,
      doctorName,
      serviceName,
      startsAt: "08:15",
    });
    const appointmentDialog = page.getByRole("dialog", {
      name: "Nueva Cita manual",
    });
    await expect(
      appointmentDialog.getByText("La Agenda ya no autoriza esta Cita manual"),
    ).toBeVisible();
    await expect(
      calendar.locator('[data-calendar-list="true"]').getByRole("button", {
        name: new RegExp(`8:15.*${patientName}`),
      }),
    ).toHaveCount(0);
    await appointmentDialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(appointmentDialog).not.toBeVisible();
    await calendar.getByRole("button", { name: "Nueva Cita manual" }).click();
    const reopenedAppointmentDialog = page.getByRole("dialog", {
      name: "Nueva Cita manual",
    });
    await expect(
      reopenedAppointmentDialog.getByRole("alert"),
    ).not.toBeVisible();
    await reopenedAppointmentDialog
      .getByRole("button", { name: "Cancelar" })
      .click();
  } finally {
    await fixture.cleanup();
  }
});

test("el Calendario opera Citas, Bloqueos y la excepción manual fuera de horario", async ({
  page,
}) => {
  const fixture = await createFixture();
  const doctorName = "Dra. Marina Calendario";
  const serviceName = "Consulta Calendario";
  const patientName = "Paciente Calendario";
  const careDate = nextClinicMonday();

  try {
    await activateAndOpenPanacea(
      page,
      fixture.invitationToken,
      fixture.ownerEmail,
    );

    await configureCalendarScenario({
      careDate,
      doctorName,
      page,
      serviceDescription: "Consulta para validar el Calendario operativo",
      serviceName,
    });

    const ownerIdentityId = await fixture.ownerIdentityId();
    const doctor = await inClinicTransaction(
      { clinicId: fixture.clinicId(), identityId: ownerIdentityId },
      (transaction) =>
        findDoctor(transaction, {
          clinicId: fixture.clinicId(),
          publicName: doctorName,
        }),
    );
    await createAvailabilityBlock(
      {
        clinicId: fixture.clinicId(),
        doctorId: doctor.id,
        endsAt: new Date(`${careDate}T08:50:00-06:00`),
        identityId: ownerIdentityId,
        privateLabel: "Capacitación Calendario",
        startsAt: new Date(`${careDate}T08:40:00-06:00`),
      },
      drizzleAvailabilityStore,
    );

    const calendar = calendarSection(page);
    const agendaList = calendar.locator('[data-calendar-list="true"]');
    await registerInlinePatient(calendar, page, {
      careDate,
      patientName,
    });

    const appointmentDialog = page.getByRole("dialog", {
      name: "Nueva Cita manual",
    });
    await appointmentDialog
      .locator('input[name="startsAt"]')
      .fill(`${careDate}T08:00`);
    await appointmentDialog
      .locator('select[name="serviceOfferId"]')
      .selectOption({
        label: `${doctorName} · ${serviceName}`,
      });
    await appointmentDialog
      .getByRole("button", { name: "Crear Cita manual" })
      .click();

    const scheduledAppointment = agendaList.getByRole("button", {
      name: new RegExp(`8:00.*${patientName}`),
    });
    const calendarBlock = agendaList.getByRole("button", {
      name: /Bloqueo.*Capacitación Calendario/,
    });
    await calendar.getByRole("button", { name: "Semana" }).click();
    await expect(calendar.locator('[data-calendar-view="week"]')).toBeVisible();
    await expect(scheduledAppointment).toContainText(serviceName);
    await expect(scheduledAppointment).toContainText(doctorName);
    await expect(calendarBlock).toContainText(doctorName);

    await calendar.getByLabel("Médico").selectOption({ label: doctorName });
    await expect(scheduledAppointment).toBeVisible();
    await expect(calendarBlock).toBeVisible();
    await calendar.getByRole("button", { name: "Día" }).click();
    await expect(
      calendar.locator('[data-calendar-view="week"]'),
    ).not.toBeVisible();
    await expect(calendar.locator('[data-calendar-view="day"]')).toBeVisible();
    await expect(scheduledAppointment).toBeVisible();
    await expect(calendarBlock).toBeVisible();

    await scheduledAppointment.click();
    const appointmentDetail = calendar
      .getByRole("heading", {
        name: "Detalle de la Cita",
      })
      .locator("xpath=../..");
    await expect(appointmentDetail).toContainText(patientName);
    await expect(
      appointmentDetail.getByText("Paciente Calendario · +50371234567", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(appointmentDetail).toContainText(serviceName);
    await page.goBack();
    await expect(appointmentDetail).not.toBeVisible();
    await scheduledAppointment.click();
    await expect(appointmentDetail).toContainText(patientName);

    await calendar.getByRole("button", { name: "Nueva Cita manual" }).click();
    const outsideAppointmentDialog = page.getByRole("dialog", {
      name: "Nueva Cita manual",
    });
    await outsideAppointmentDialog
      .locator('input[name="startsAt"]')
      .fill(`${careDate}T09:35`);
    await outsideAppointmentDialog
      .locator('select[name="serviceOfferId"]')
      .selectOption({ label: `${doctorName} · ${serviceName}` });
    await outsideAppointmentDialog
      .getByRole("button", { name: "Crear Cita manual" })
      .click();
    await expect(
      outsideAppointmentDialog.getByText(
        "La Cita no cabe por completo en el Horario vigente. Confirme la excepción para crearla sin modificar los demás controles de capacidad.",
      ),
    ).toBeVisible();
    const outsideScheduleAppointment = agendaList.getByRole("button", {
      name: new RegExp(`9:35.*${patientName}`),
    });
    await expect(outsideScheduleAppointment).not.toBeVisible();
    await outsideAppointmentDialog
      .getByRole("button", { name: "Confirmar Cita fuera de horario" })
      .click();

    await expect(outsideScheduleAppointment).toContainText("Fuera de horario");
    await outsideScheduleAppointment.click();
    await expect(appointmentDetail).toContainText("Cita fuera de horario");
  } finally {
    await fixture.cleanup();
  }
});

async function configureCalendarScenario(input: {
  careDate: string;
  doctorName: string;
  page: Page;
  serviceDescription: string;
  serviceName: string;
}) {
  await goToPanaceaRoute(input.page, "/configuracion/equipo");
  const profile = section(input.page, "Configuración inicial");
  await profile.getByLabel("Nombre público").fill(input.doctorName);
  await profile.getByLabel("Especialidad principal").fill("Medicina general");
  await profile.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(profile.getByText("Perfil de Médico guardado.")).toBeVisible();
  await reloadPanacea(input.page);

  await goToPanaceaRoute(input.page, "/configuracion/servicios");
  const catalog = section(input.page, "Catálogo de Servicios");
  const createServiceForm = catalog
    .getByRole("button", { name: "Crear Servicio" })
    .locator("..");
  await createServiceForm.locator('input[name="name"]').fill(input.serviceName);
  await createServiceForm
    .locator('textarea[name="description"]')
    .fill(input.serviceDescription);
  await createServiceForm.locator('select[name="doctorId"]').selectOption({
    label: input.doctorName,
  });
  await createServiceForm.locator('input[name="priceUsd"]').fill("35.00");
  await createServiceForm.locator('input[name="durationMinutes"]').fill("30");
  await createServiceForm.locator('input[name="bufferMinutes"]').fill("0");
  await createServiceForm
    .getByRole("button", { name: "Crear Servicio" })
    .click();
  await expect(
    catalog.getByText(`Servicio ${input.serviceName} creado.`),
  ).toBeVisible();
  await saveSchedule(input.page, input.careDate, input.doctorName);
}

async function registerInlinePatient(
  calendar: Locator,
  page: Page,
  input: {
    careDate: string;
    patientName: string;
    phone?: string;
    reuseExistingContact?: boolean;
  },
) {
  await calendar.locator('input[type="date"]').fill(input.careDate);
  await calendar.getByRole("button", { name: "Nueva Cita manual" }).click();
  const appointmentDialog = page.getByRole("dialog", {
    name: "Nueva Cita manual",
  });
  await appointmentDialog
    .getByRole("button", { name: "Crear Paciente con Contacto" })
    .click();
  const patientNameParts = input.patientName.trim().split(/\s+/);
  const patientGivenNames = patientNameParts.shift() ?? "";
  await appointmentDialog
    .getByLabel("Nombres del Paciente")
    .fill(patientGivenNames);
  await appointmentDialog
    .getByLabel("Apellidos del Paciente")
    .fill(patientNameParts.join(" "));
  await appointmentDialog
    .getByLabel("Teléfono")
    .fill(input.phone ?? "+50371234567");
  await appointmentDialog
    .getByLabel("Fecha de nacimiento del Paciente")
    .fill("2000-04-02");
  if (input.reuseExistingContact === true) {
    await appointmentDialog
      .getByRole("button", { name: "Reutilizar Contacto" })
      .click();
    await expect(
      appointmentDialog.getByRole("button", {
        name: "Contacto seleccionado",
      }),
    ).toBeVisible();
  }
  await appointmentDialog
    .getByRole("button", { name: "Crear Paciente y Contacto" })
    .click();
  await expect(
    appointmentDialog.getByText(
      `Paciente ${input.patientName} seleccionado para la nueva Cita.`,
    ),
  ).toBeVisible();
}

async function createManualAppointmentInCalendar(
  calendar: Locator,
  page: Page,
  input: {
    careDate: string;
    doctorName: string;
    serviceName: string;
    startsAt: string;
  },
) {
  const appointmentDialog = page.getByRole("dialog", {
    name: "Nueva Cita manual",
  });
  if (!(await appointmentDialog.isVisible())) {
    await calendar.locator('input[type="date"]').fill(input.careDate);
    await calendar.getByRole("button", { name: "Nueva Cita manual" }).click();
  }
  await appointmentDialog
    .locator('input[name="startsAt"]')
    .fill(`${input.careDate}T${input.startsAt}`);
  await appointmentDialog
    .locator('select[name="serviceOfferId"]')
    .selectOption({
      label: `${input.doctorName} · ${input.serviceName}`,
    });
  await appointmentDialog
    .getByRole("button", { name: "Crear Cita manual" })
    .click();
}

function calendarSection(page: Page) {
  return page.getByRole("region", { name: "Calendario" });
}

function section(page: Page, heading: string) {
  return page
    .getByRole("heading", { level: 2, name: heading })
    .locator("xpath=../..");
}

async function activateAndOpenPanacea(
  page: Page,
  invitationToken: string,
  email: string,
) {
  await page.goto(`/activar-invitacion?token=${invitationToken}`);
  await waitForPanaceaInteractivity(page);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña").fill(password);
  await page.getByRole("button", { name: "Activar cuenta" }).click();
  await expect(
    page.getByText(
      "La cuenta se activó. En unos segundos la llevaremos al inicio de sesión.",
    ),
  ).toBeVisible();

  await signInAndOpenPanacea(page, email);
}

async function signInAndOpenPanacea(page: Page, email: string) {
  await page.goto("/");
  await waitForPanaceaInteractivity(page);
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByLabel("Código de verificación")).toBeVisible();
  await waitForPanaceaInteractivity(page);
  await page.getByLabel("Código de verificación").fill(e2eOtp);
  await page.getByRole("button", { name: "Verificar y abrir Praxia" }).click();
  await expect(page).toHaveURL(/\/calendario$/);
  await waitForPanaceaInteractivity(page);
}

async function waitForPanaceaInteractivity(page: Page) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-panacea-interactive",
    "true",
  );
}

async function reloadPanacea(page: Page) {
  await page.reload();
  await waitForPanaceaInteractivity(page);
}

async function goToPanaceaRoute(page: Page, route: string) {
  await page.goto(route);
  await waitForPanaceaInteractivity(page);
}

async function saveSchedule(
  page: Page,
  effectiveFrom: string,
  doctorName: string,
) {
  await goToPanaceaRoute(page, "/configuracion/disponibilidad");
  const availability = section(page, "Horarios y Bloqueos");
  await availability.locator('select[name="doctorId"]').first().selectOption({
    label: doctorName,
  });
  await availability.locator('input[name="effectiveFrom"]').fill(effectiveFrom);
  await availability.getByLabel("Día de franja 1").selectOption("1");
  await availability.getByLabel("Inicio de franja 1").fill("08:00");
  await availability.getByLabel("Fin de franja 1").fill("10:00");
  await availability.getByRole("button", { name: "Guardar Horario" }).click();
  await expect(
    availability.getByText("Horario vigente actualizado para opciones nuevas."),
  ).toBeVisible();
  await goToPanaceaRoute(page, "/calendario");
}

async function expectCareOptions(
  page: Page,
  doctorName: string,
  serviceName: string,
  date: string,
  available: boolean,
) {
  await goToPanaceaRoute(page, "/configuracion/disponibilidad");
  const careOptions = section(page, "Opciones de atención");
  await careOptions.locator('select[name="doctorId"]').selectOption({
    label: doctorName,
  });
  await careOptions.locator('select[name="serviceId"]').selectOption({
    label: serviceName,
  });
  await careOptions.locator('input[name="from"]').fill(date);
  await careOptions.locator('input[name="to"]').fill(date);
  await careOptions.getByRole("button", { name: "Consultar Opciones" }).click();
  if (available) {
    await expect(
      careOptions.locator("li").filter({ hasText: /202\d/ }),
    ).not.toHaveCount(0);
  } else {
    await expect(
      careOptions.getByText("No hay Opciones de atención para ese rango."),
    ).toBeVisible();
  }
  await goToPanaceaRoute(page, "/calendario");
}

async function configureInvitedDoctor(input: {
  clinicId: string;
  date: string;
  ownerIdentityId: string;
  serviceName: string;
}) {
  const configuration = await inClinicTransaction(
    { clinicId: input.clinicId, identityId: input.ownerIdentityId },
    async (transaction) => {
      const [doctor, service] = await Promise.all([
        transaction.query.doctors.findFirst({
          columns: { id: true },
          where: and(
            eq(doctors.clinicId, input.clinicId),
            isNull(doctors.publicName),
          ),
        }),
        transaction.query.services.findFirst({
          columns: { id: true },
          where: and(
            eq(services.clinicId, input.clinicId),
            eq(services.name, input.serviceName),
          ),
        }),
      ]);
      if (doctor === undefined || service === undefined) {
        throw new Error("Falta la configuración E2E del Médico invitado");
      }
      return { doctorId: doctor.id, serviceId: service.id };
    },
  );
  await addServiceOffer(
    {
      bufferMinutes: 0,
      clinicId: input.clinicId,
      doctorId: configuration.doctorId,
      durationMinutes: 30,
      identityId: input.ownerIdentityId,
      priceUsd: "35.00",
      serviceId: configuration.serviceId,
    },
    drizzleServiceCatalogStore,
  );
  await configureEffectiveSchedule(
    {
      clinicId: input.clinicId,
      doctorId: configuration.doctorId,
      effectiveFrom: input.date,
      identityId: input.ownerIdentityId,
      periods: [{ dayOfWeek: 1, endTime: "10:00", startTime: "08:00" }],
    },
    drizzleAvailabilityStore,
  );
}

async function inviteDoctor(input: {
  clinicId: string;
  ownerIdentityId: string;
  recipientEmail: string;
  recipientName: string;
}) {
  let invitationToken: string | undefined;
  await inviteAdditionalDoctor(
    {
      clinicId: input.clinicId,
      identityId: input.ownerIdentityId,
      recipient: { email: input.recipientEmail, name: input.recipientName },
    },
    {
      store: drizzleDoctorInvitationStore,
      async sendInvitation(invitation) {
        invitationToken = invitation.token;
      },
    },
  );
  if (invitationToken === undefined) throw new Error("Falta la invitación E2E");
  return { token: invitationToken };
}

type DoctorFixture = {
  clinicId: string;
  ownerIdentityId: string;
  publicName: string;
};

async function createConfirmedAppointment(
  input: DoctorFixture & {
    date: string;
  },
) {
  await inClinicTransaction(
    { clinicId: input.clinicId, identityId: input.ownerIdentityId },
    async (transaction) => {
      const doctor = await findDoctor(transaction, input);
      await transaction.insert(appointments).values({
        clinicId: input.clinicId,
        doctorId: doctor.id,
        endsAt: new Date(`${input.date}T09:00:00-06:00`),
        startsAt: new Date(`${input.date}T08:00:00-06:00`),
      });
    },
  );
}

async function clearConfirmedAppointments(input: DoctorFixture) {
  await inClinicTransaction(
    { clinicId: input.clinicId, identityId: input.ownerIdentityId },
    async (transaction) => {
      const doctor = await findDoctor(transaction, input);
      await transaction
        .delete(appointments)
        .where(
          and(
            eq(appointments.clinicId, input.clinicId),
            eq(appointments.doctorId, doctor.id),
          ),
        );
    },
  );
}

async function createTemporaryReservation(
  input: DoctorFixture & {
    date: string;
  },
) {
  await inClinicTransaction(
    { clinicId: input.clinicId, identityId: input.ownerIdentityId },
    async (transaction) => {
      const doctor = await findDoctor(transaction, input);
      await transaction.insert(temporaryReservations).values({
        clinicId: input.clinicId,
        doctorId: doctor.id,
        endsAt: new Date(`${input.date}T09:00:00-06:00`),
        expiresAt: new Date(`${input.date}T10:00:00-06:00`),
        startsAt: new Date(`${input.date}T08:00:00-06:00`),
      });
    },
  );
}

async function clearTemporaryReservations(input: DoctorFixture) {
  await inClinicTransaction(
    { clinicId: input.clinicId, identityId: input.ownerIdentityId },
    async (transaction) => {
      const doctor = await findDoctor(transaction, input);
      await transaction
        .delete(temporaryReservations)
        .where(
          and(
            eq(temporaryReservations.clinicId, input.clinicId),
            eq(temporaryReservations.doctorId, doctor.id),
          ),
        );
    },
  );
}

async function findDoctor(
  transaction: Parameters<Parameters<typeof inClinicTransaction>[1]>[0],
  input: { clinicId: string; publicName: string },
) {
  const doctor = await transaction.query.doctors.findFirst({
    columns: { id: true },
    where: and(
      eq(doctors.clinicId, input.clinicId),
      eq(doctors.publicName, input.publicName),
    ),
  });
  if (doctor === undefined) throw new Error("Falta el Médico E2E");
  return doctor;
}

function nextClinicMonday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/El_Salvador",
    year: "numeric",
  });
  const current = new Date();
  for (let offset = 7; offset <= 13; offset += 1) {
    const candidate = new Date(
      current.valueOf() + offset * 24 * 60 * 60 * 1000,
    );
    const parts = formatter.formatToParts(candidate);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    if (new Date(`${date}T00:00:00-06:00`).getUTCDay() === 1) return date;
  }
  throw new Error("No se encontró el próximo lunes de la Clínica");
}

async function createFixture() {
  const superadminId = `e2e-superadmin-${randomUUID()}`;
  const ownerEmail = `e2e-owner-${randomUUID()}@example.test`;
  const invitedDoctorEmail = `e2e-doctor-${randomUUID()}@example.test`;
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
      clinicId: () => clinic.id,
      clinicName,
      invitationToken,
      invitedDoctorEmail,
      ownerEmail,
      superadminIdentityId: superadminId,
      async ownerIdentityId() {
        const owner = await db.query.user.findFirst({
          columns: { id: true },
          where: eq(identities.email, ownerEmail),
        });
        if (owner === undefined) throw new Error("Falta el propietario E2E");
        return owner.id;
      },
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
              .delete(configurationAuditEvents)
              .where(eq(configurationAuditEvents.clinicId, createdClinicId));
            await transaction
              .delete(appointmentEvents)
              .where(eq(appointmentEvents.clinicId, createdClinicId));
            await transaction
              .delete(appointments)
              .where(eq(appointments.clinicId, createdClinicId));
            await transaction
              .delete(clinics)
              .where(eq(clinics.id, createdClinicId));
          });
        }
        await db
          .delete(verification)
          .where(eq(verification.identifier, `sign-in-otp-${ownerEmail}`));
        await db
          .delete(verification)
          .where(
            eq(verification.identifier, `sign-in-otp-${invitedDoctorEmail}`),
          );
        await db.delete(identities).where(eq(identities.email, ownerEmail));
        await db
          .delete(identities)
          .where(eq(identities.email, invitedDoctorEmail));
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
          .delete(configurationAuditEvents)
          .where(eq(configurationAuditEvents.clinicId, createdClinicId));
        await transaction
          .delete(appointmentEvents)
          .where(eq(appointmentEvents.clinicId, createdClinicId));
        await transaction
          .delete(appointments)
          .where(eq(appointments.clinicId, createdClinicId));
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
