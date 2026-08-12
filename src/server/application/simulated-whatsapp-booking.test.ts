import { describe, expect, it } from "vitest";

import {
  createInMemorySimulatedWhatsAppBookingStore,
  processSimulatedWhatsAppMessage,
} from "./simulated-whatsapp-booking";

describe("reservar una Cita adulta por WhatsApp simulado", () => {
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
});
