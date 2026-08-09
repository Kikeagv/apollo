import { randomUUID } from "node:crypto";

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

test("el alta de perfil no envía el formulario antes de hidratar Panacea", async ({
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
      await preHydrationPage.goto("/");

      const profile = section(preHydrationPage, "Configuración inicial");
      const submit = profile.getByRole("button", {
        name: "Guardar perfil",
      });
      await expect(submit).toBeDisabled();
      await submit.click({ force: true });
      await expect(preHydrationPage).toHaveURL(/\/$/);
      await expect(profile).toBeVisible();
    } finally {
      await preHydrationContext.close();
    }
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

    const profile = section(page, "Configuración inicial");
    await profile.getByLabel("Nombre público").fill(ownerName);
    await profile
      .getByLabel("Especialidad principal")
      .fill("Medicina familiar");
    await profile.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(profile.getByText("Perfil de Médico guardado.")).toBeVisible();
    await page.reload();

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
      await page.reload();
      await configureInvitedDoctor({
        clinicId: fixture.clinicId(),
        date: careDate,
        ownerIdentityId,
        serviceName: consultationName,
      });
      await page.reload();
      await expectCareOptions(
        page,
        "Médico sin nombre público",
        consultationName,
        careDate,
        false,
      );

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

    await page.reload();
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
    await page.reload();
    const calendar = section(page, "Calendario");
    await calendar.locator('input[type="date"]').fill(careDate);
    const anaBlock = calendar.getByRole("button", {
      name: /Bloqueo.*Capacitación de Ana/,
    });
    const brunoBlock = calendar.getByRole("button", {
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
    await page.reload();
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

test("Panacea registra fichas dentro de una nueva Cita y las deja seleccionadas", async ({
  page,
}) => {
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

    const calendar = section(page, "Calendario");
    await registerInlinePatient(calendar, {
      contactName: "Ana Inline",
      patientName: "Lucía Inline",
    });
    await expect(calendar.getByLabel("Paciente")).toHaveValue(/.+/);

    await calendar.locator('input[type="date"]').fill(careDate);
    await calendar.locator('input[name="startsAt"]').fill(`${careDate}T08:00`);
    await calendar.locator('select[name="serviceOfferId"]').selectOption({
      label: `${doctorName} · ${serviceName}`,
    });
    await calendar
      .getByRole("button", { name: "Crear Cita manual" })
      .click();
    await expect(calendar.getByRole("heading", { name: "Detalle de la Cita" })).toBeVisible();
    await expect(
      calendar.getByRole("link", { name: "Abrir ficha del Paciente" }),
    ).toBeVisible();
    await expect(
      calendar.getByRole("link", { name: "Abrir ficha del Contacto" }),
    ).toBeVisible();
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
  const contactName = "Contacto Calendario";
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

    const calendar = section(page, "Calendario");
    await registerInlinePatient(calendar, { contactName, patientName });

    await calendar.locator('input[type="date"]').fill(careDate);
    await calendar.locator('input[name="startsAt"]').fill(`${careDate}T08:00`);
    await calendar.locator('select[name="serviceOfferId"]').selectOption({
      label: `${doctorName} · ${serviceName}`,
    });
    await calendar.getByRole("button", { name: "Crear Cita manual" }).click();

    const scheduledAppointment = calendar.getByRole("button", {
      name: new RegExp(`8:00.*${patientName}`),
    });
    const calendarBlock = calendar.getByRole("button", {
      name: /Bloqueo.*Capacitación Calendario/,
    });
    await calendar.getByRole("button", { name: "Semana" }).click();
    await expect(
      calendar.locator('[class*="xl:grid-cols-7"]'),
    ).toBeVisible();
    await expect(scheduledAppointment).toContainText(serviceName);
    await expect(scheduledAppointment).toContainText(doctorName);
    await expect(calendarBlock).toContainText(doctorName);

    await calendar.getByLabel("Médico").selectOption({ label: doctorName });
    await expect(scheduledAppointment).toBeVisible();
    await expect(calendarBlock).toBeVisible();
    await calendar.getByRole("button", { name: "Día" }).click();
    await expect(
      calendar.locator('[class*="xl:grid-cols-7"]'),
    ).not.toBeVisible();
    await expect(scheduledAppointment).toBeVisible();
    await expect(calendarBlock).toBeVisible();

    await scheduledAppointment.click();
    const appointmentDetail = calendar
      .getByRole("heading", {
        name: "Detalle de la Cita",
      })
      .locator("..");
    await expect(appointmentDetail).toContainText(patientName);
    await expect(appointmentDetail).toContainText(contactName);
    await expect(appointmentDetail).toContainText(serviceName);

    await calendar.locator('input[name="startsAt"]').fill(`${careDate}T09:35`);
    await calendar.getByRole("button", { name: "Crear Cita manual" }).click();
    await expect(
      calendar.getByText(
        "La Cita no cabe por completo en el Horario vigente. Confirme la excepción para crearla sin modificar los demás controles de capacidad.",
      ),
    ).toBeVisible();
    const outsideScheduleAppointment = calendar.getByRole("button", {
      name: new RegExp(`9:35.*${patientName}`),
    });
    await expect(outsideScheduleAppointment).not.toBeVisible();
    await calendar
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
  const profile = section(input.page, "Configuración inicial");
  await profile.getByLabel("Nombre público").fill(input.doctorName);
  await profile.getByLabel("Especialidad principal").fill("Medicina general");
  await profile.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(profile.getByText("Perfil de Médico guardado.")).toBeVisible();
  await input.page.reload();

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
  await saveSchedule(input.page, input.careDate, input.doctorName);
}

async function registerInlinePatient(
  calendar: Locator,
  input: { contactName: string; patientName: string },
) {
  await calendar.getByRole("button", { name: "Registrar Paciente nuevo" }).click();
  await calendar.getByLabel("Nombre del Contacto").fill(input.contactName);
  await calendar
    .getByLabel("Teléfono E.164 del Contacto")
    .fill("+50371234567");
  await calendar.getByLabel("Nombre del Paciente").fill(input.patientName);
  await calendar
    .getByLabel("Fecha de nacimiento del Paciente")
    .fill("2018-04-02");
  await calendar
    .getByRole("button", { name: "Registrar Contacto y Paciente" })
    .click();
  await expect(
    calendar.getByText(
      `Paciente ${input.patientName} seleccionado para la nueva Cita.`,
    ),
  ).toBeVisible();
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
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña").fill(password);
  await page.getByRole("button", { name: "Activar cuenta" }).click();
  await expect(
    page.getByText(
      "La cuenta se activó. Ya puede iniciar sesión con su correo y contraseña.",
    ),
  ).toBeVisible();

  await signInAndOpenPanacea(page, email);
}

async function signInAndOpenPanacea(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Código de verificación").fill(e2eOtp);
  await page.getByRole("button", { name: "Verificar y abrir Panacea" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function saveSchedule(
  page: Page,
  effectiveFrom: string,
  doctorName: string,
) {
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
}

async function expectCareOptions(
  page: Page,
  doctorName: string,
  serviceName: string,
  date: string,
  available: boolean,
) {
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
