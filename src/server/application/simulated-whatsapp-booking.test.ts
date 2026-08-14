import { describe, expect, it } from "vitest";

import {
  createInMemorySimulatedWhatsAppBookingStore,
  processSimulatedWhatsAppMessage,
} from "./simulated-whatsapp-booking";

describe("reservar una Cita adulta por WhatsApp simulado", () => {
  it("suprime solo recordatorios pendientes cuando responde el Contacto", async () => {
    const store = createInMemorySimulatedWhatsAppBookingStore({
      clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
      contacts: [{ id: "contact-1", name: "Ana", phoneE164: "+50370000002" }],
      links: [],
      offers: [],
      options: [],
      patients: [],
    });
    const suppressed: Array<{ clinicId: string; contactId: string }> = [];
    store.suppressPendingReminderDeliveries = async (input) => {
      suppressed.push(input);
      return 2;
    };

    await processSimulatedWhatsAppMessage(
      { from: "+50370000002", id: "reply-1", text: "info", to: "+50370000001" },
      store,
      new Date("2026-08-14T12:00:00.000Z"),
    );

    expect(suppressed).toEqual([
      {
        clinicId: "clinic-1",
        contactId: "contact-1",
        now: new Date("2026-08-14T12:00:00.000Z"),
      },
    ]);
  });

  it("exige seleccionar explícitamente el Paciente y confirma una Reserva temporal", async () => {
    const store = createInMemorySimulatedWhatsAppBookingStore({
      clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
      contacts: [{ id: "contact-1", name: "Ana", phoneE164: "+50370000002" }],
      offers: [
        {
          doctorId: "doctor-1",
          doctorName: "Dra. Sol",
          id: "offer-1",
          priceUsd: "25.00",
          serviceName: "Consulta",
        },
      ],
      options: [new Date("2026-08-17T14:00:00.000Z")],
      patients: [{ birthDate: "1990-01-01", id: "patient-1", name: "Ana" }],
      links: [{ contactId: "contact-1", patientId: "patient-1" }],
    });
    const now = new Date("2026-08-12T14:00:00.000Z");

    await expect(
      processSimulatedWhatsAppMessage(
        {
          id: "message-1",
          text: "opciones offer-1 2026-08-17",
          to: "+50370000001",
          from: "+503 7000 0002",
        },
        store,
        now,
      ),
    ).resolves.toMatchObject({ kind: "patient-selection-required" });

    await processSimulatedWhatsAppMessage(
      {
        id: "message-2",
        text: "paciente patient-1",
        to: "+50370000001",
        from: "+50370000002",
      },
      store,
      now,
    );
    await processSimulatedWhatsAppMessage(
      {
        id: "message-3",
        text: "opciones offer-1 2026-08-17",
        to: "+50370000001",
        from: "+50370000002",
      },
      store,
      now,
    );
    const held = await processSimulatedWhatsAppMessage(
      {
        id: "message-4",
        text: "reservar 2026-08-17T14:00:00.000Z",
        to: "+50370000001",
        from: "+50370000002",
      },
      store,
      now,
    );

    expect(held).toMatchObject({
      expiresAt: new Date("2026-08-12T14:10:00.000Z"),
      kind: "reservation-held",
    });
    const confirmation = await processSimulatedWhatsAppMessage(
      {
        id: "message-5",
        text: "confirmar",
        to: "+50370000001",
        from: "+50370000002",
      },
      store,
      now,
    );
    expect(confirmation).toMatchObject({
      kind: "appointment-confirmed",
      origin: "reservation",
      patientId: "patient-1",
    });
    await expect(
      processSimulatedWhatsAppMessage(
        {
          id: "message-5",
          text: "confirmar",
          to: "+50370000001",
          from: "+50370000002",
        },
        store,
        now,
      ),
    ).resolves.toEqual(confirmation);
    expect(store.appointments).toHaveLength(1);
  });

  it("registra un adulto con DUI y no duplica la Reserva ni la Cita al repetir un mensaje", async () => {
    const store = createInMemorySimulatedWhatsAppBookingStore({
      clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
      contacts: [{ id: "contact-1", name: "Ana", phoneE164: "+50370000002" }],
      offers: [
        {
          doctorId: "doctor-1",
          doctorName: "Dra. Sol",
          id: "offer-1",
          priceUsd: "25.00",
          serviceName: "Consulta",
        },
      ],
      options: [new Date("2026-08-17T14:00:00.000Z")],
      patients: [],
      links: [],
    });
    const now = new Date("2026-08-12T14:00:00.000Z");

    await expect(
      processSimulatedWhatsAppMessage(
        {
          id: "message-1",
          text: "registrar adulto|Ana Pérez|01234567-8|1990-01-01",
          to: "+50370000001",
          from: "+50370000002",
        },
        store,
        now,
      ),
    ).resolves.toMatchObject({ kind: "patient-registered" });
    expect(store.patients).toMatchObject([
      { birthDate: "1990-01-01", dui: "01234567-8", name: "Ana Pérez" },
    ]);

    await processSimulatedWhatsAppMessage(
      {
        id: "message-2",
        text: `paciente ${store.patients[0]?.id}`,
        to: "+50370000001",
        from: "+50370000002",
      },
      store,
      now,
    );
    await processSimulatedWhatsAppMessage(
      {
        id: "message-3",
        text: "opciones offer-1 2026-08-17",
        to: "+50370000001",
        from: "+50370000002",
      },
      store,
      now,
    );
    const input = {
      id: "message-4",
      text: "reservar 2026-08-17T14:00:00.000Z",
      to: "+50370000001",
      from: "+50370000002",
    };
    const first = await processSimulatedWhatsAppMessage(input, store, now);
    const duplicate = await processSimulatedWhatsAppMessage(input, store, now);

    expect(duplicate).toEqual(first);
    expect(store.reservations).toHaveLength(1);
  });

  it("registra un menor con el DUI de su Tutor y permite reservarlo", async () => {
    const store = createInMemorySimulatedWhatsAppBookingStore({
      clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
      contacts: [{ id: "contact-1", name: "Ana", phoneE164: "+50370000002" }],
      offers: [
        {
          doctorId: "doctor-1",
          doctorName: "Dra. Sol",
          id: "offer-1",
          priceUsd: "25.00",
          serviceName: "Consulta",
        },
      ],
      options: [new Date("2026-08-17T14:00:00.000Z")],
      patients: [],
      links: [],
    });
    const now = new Date("2026-08-12T14:00:00.000Z");

    const registration = await processSimulatedWhatsAppMessage(
      {
        from: "+50370000002",
        id: "message-minor-1",
        text: "registrar menor|Lucía Pérez|01234567-8|2018-04-02",
        to: "+50370000001",
      },
      store,
      now,
    );

    expect(registration).toMatchObject({ kind: "patient-registered" });
    const patientId =
      registration.kind === "patient-registered" ? registration.patientId : "";
    await processSimulatedWhatsAppMessage(
      {
        from: "+50370000002",
        id: "message-minor-2",
        text: `paciente ${patientId}`,
        to: "+50370000001",
      },
      store,
      now,
    );
    await processSimulatedWhatsAppMessage(
      {
        from: "+50370000002",
        id: "message-minor-3",
        text: "opciones offer-1 2026-08-17",
        to: "+50370000001",
      },
      store,
      now,
    );

    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000002",
          id: "message-minor-4",
          text: "reservar 2026-08-17T14:00:00.000Z",
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toMatchObject({ kind: "reservation-held" });
  });

  it("no revela a un Contacto no vinculado si un menor existe", async () => {
    const store = createInMemorySimulatedWhatsAppBookingStore({
      clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
      contacts: [
        { id: "tutor-1", name: "Ana", phoneE164: "+50370000002" },
        { id: "contact-2", name: "Carlos", phoneE164: "+50370000003" },
      ],
      links: [
        {
          contactId: "tutor-1",
          guardianDui: "01234567-8",
          guardianshipVerificationStatus: "pending",
          patientId: "minor-1",
          relationship: "tutor",
        },
      ],
      offers: [],
      options: [],
      patients: [
        { birthDate: "2018-04-02", id: "minor-1", name: "Lucía Pérez" },
      ],
    });
    const now = new Date("2026-08-12T14:00:00.000Z");
    const message = (id: string, patientId: string) =>
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000003",
          id,
          text: `paciente ${patientId}`,
          to: "+50370000001",
        },
        store,
        now,
      );

    await expect(message("message-privacy-1", "minor-1")).resolves.toEqual(
      await message("message-privacy-2", "patient-that-does-not-exist"),
    );
  });

  it("solo acepta el registro de menor cuando la fecha prueba que aún es menor", async () => {
    const store = createInMemorySimulatedWhatsAppBookingStore({
      clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
      contacts: [{ id: "contact-1", name: "Ana", phoneE164: "+50370000002" }],
      links: [],
      offers: [],
      options: [],
      patients: [],
    });
    const now = new Date("2026-08-12T14:00:00.000Z");

    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000002",
          id: "message-adult-as-minor",
          text: "registrar menor|Ana Pérez|01234567-8|1990-01-01",
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toMatchObject({ kind: "invalid-request" });
  });

  it("permite al Autor reprogramar dentro de la Ventana y conserva el resultado ante un duplicado", async () => {
    const now = new Date("2026-08-12T14:00:00.000Z");
    const store = selfManagementStore([
      new Date("2026-08-12T16:00:00.000Z"),
      new Date("2026-08-12T17:00:00.000Z"),
    ]);
    const appointmentId = await confirmAppointment(
      store,
      now,
      new Date("2026-08-12T16:00:00.000Z"),
    );

    const request = {
      from: "+50370000002",
      id: "reschedule-author",
      text: `reprogramar ${appointmentId} 2026-08-12T17:00:00.000Z`,
      to: "+50370000001",
    };
    const response = await processSimulatedWhatsAppMessage(request, store, now);

    expect(response).toMatchObject({
      id: appointmentId,
      kind: "appointment-rescheduled",
      startsAt: new Date("2026-08-12T17:00:00.000Z"),
    });
    await expect(
      processSimulatedWhatsAppMessage(request, store, now),
    ).resolves.toEqual(response);
    expect(store.appointments).toMatchObject([
      { id: appointmentId, startsAt: new Date("2026-08-12T17:00:00.000Z") },
    ]);
    expect(store.appointmentEvents).toContainEqual({
      appointmentId,
      type: "rescheduled",
    });
  });

  it("escala a Panacea la solicitud de otro Tutor sin cambiar la Cita", async () => {
    const now = new Date("2026-08-12T14:00:00.000Z");
    const store = selfManagementStore(
      [new Date("2026-08-12T16:00:00.000Z")],
      [
        { id: "contact-author", name: "Ana", phoneE164: "+50370000002" },
        { id: "contact-tutor", name: "Carlos", phoneE164: "+50370000003" },
      ],
    );
    const appointmentId = await confirmAppointment(
      store,
      now,
      new Date("2026-08-12T16:00:00.000Z"),
    );
    await processSimulatedWhatsAppMessage(
      {
        from: "+50370000003",
        id: "select-tutor-patient",
        text: "paciente patient-1",
        to: "+50370000001",
      },
      store,
      now,
    );

    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000003",
          id: "cancel-tutor-appointment",
          text: `cancelar ${appointmentId}`,
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
    expect(store.appointments).toMatchObject([
      { id: appointmentId, status: "confirmed" },
    ]);
    expect(store.escalations).toContainEqual({
      action: "cancel",
      appointmentId,
      contactId: "contact-tutor",
    });
    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000003",
          id: "message-after-escalation",
          text: "info",
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
  });

  it("incluye el límite exacto de 12 horas y rechaza una reprogramación sin capacidad", async () => {
    const now = new Date("2026-08-12T14:00:00.000Z");
    const initialStart = new Date("2026-08-13T02:00:00.000Z");
    const store = selfManagementStore([initialStart]);
    const appointmentId = await confirmAppointment(store, now, initialStart);

    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000002",
          id: "reschedule-without-capacity",
          text: `reprogramar ${appointmentId} 2026-08-13T02:30:00.000Z`,
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toMatchObject({ kind: "appointment-unavailable" });
    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000002",
          id: "cancel-at-window-boundary",
          text: `cancelar ${appointmentId}`,
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toMatchObject({
      id: appointmentId,
      kind: "appointment-cancelled",
    });
  });

  it("escala sin modificar una Cita cuando la solicitud llega fuera de la Ventana", async () => {
    const now = new Date("2026-08-12T14:00:00.000Z");
    const startsAt = new Date("2026-08-13T02:05:00.000Z");
    const store = selfManagementStore([startsAt]);
    const appointmentId = await confirmAppointment(store, now, startsAt);

    await expect(
      processSimulatedWhatsAppMessage(
        {
          from: "+50370000002",
          id: "cancel-after-window",
          text: `cancelar ${appointmentId}`,
          to: "+50370000001",
        },
        store,
        now,
      ),
    ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
    expect(store.appointments).toContainEqual(
      expect.objectContaining({ id: appointmentId, status: "confirmed" }),
    );
    expect(store.escalations).toContainEqual({
      action: "cancel",
      appointmentId,
      contactId: "contact-author",
    });
  });
});

function selfManagementStore(
  options: Date[],
  contacts = [{ id: "contact-author", name: "Ana", phoneE164: "+50370000002" }],
) {
  return createInMemorySimulatedWhatsAppBookingStore({
    clinic: { id: "clinic-1", whatsappNumberE164: "+50370000001" },
    contacts,
    links: contacts.map((contact) => ({
      contactId: contact.id,
      patientId: "patient-1",
    })),
    offers: [
      {
        doctorId: "doctor-1",
        doctorName: "Dra. Sol",
        id: "offer-1",
        priceUsd: "25.00",
        serviceName: "Consulta",
      },
    ],
    options,
    patients: [{ birthDate: "1990-01-01", id: "patient-1", name: "Ana" }],
  });
}

async function confirmAppointment(
  store: ReturnType<typeof selfManagementStore>,
  now: Date,
  startsAt: Date,
) {
  await processSimulatedWhatsAppMessage(
    {
      from: "+50370000002",
      id: "select-author-patient",
      text: "paciente patient-1",
      to: "+50370000001",
    },
    store,
    now,
  );
  await processSimulatedWhatsAppMessage(
    {
      from: "+50370000002",
      id: "select-author-offer",
      text: `opciones offer-1 ${startsAt.toISOString().slice(0, 10)}`,
      to: "+50370000001",
    },
    store,
    now,
  );
  await processSimulatedWhatsAppMessage(
    {
      from: "+50370000002",
      id: "hold-author-reservation",
      text: `reservar ${startsAt.toISOString()}`,
      to: "+50370000001",
    },
    store,
    now,
  );
  const response = await processSimulatedWhatsAppMessage(
    {
      from: "+50370000002",
      id: "confirm-author-reservation",
      text: "confirmar",
      to: "+50370000001",
    },
    store,
    now,
  );
  if (response.kind !== "appointment-confirmed") {
    throw new Error("La prueba no pudo confirmar la Cita");
  }
  return response.id;
}
