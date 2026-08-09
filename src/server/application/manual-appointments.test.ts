import { describe, expect, it, vi } from "vitest";

import {
  cancelManualAppointment,
  createManualAppointment,
  ManualAppointmentNotCancellableError,
  ManualAppointmentOutsideScheduleConfirmationRequiredError,
} from "./manual-appointments";

describe("crear una Cita manual", () => {
  it("solicita y registra una confirmación inmediata para el Contacto vinculado elegido", async () => {
    const startsAt = new Date("2026-08-10T14:00:00.000Z");
    const send = vi.fn().mockResolvedValue(undefined);
    const recordMessageDelivery = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({
      id: "appointment-1",
      startsAt,
      transactionalMessage: {
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        recipient: {
          id: "contact-1",
          name: "Ana Martínez",
          phoneE164: "+50371234567",
        },
        type: "manual-confirmation",
      },
    });

    await expect(
      createManualAppointment(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          identityId: "operator-1",
          notificationRecipientContactId: "contact-1",
          patientId: "patient-1",
          serviceOfferId: "offer-1",
          startsAt,
        },
        { create, recordMessageDelivery },
        new Date("2026-08-01T00:00:00.000Z"),
        { send },
      ),
    ).resolves.toMatchObject({ id: "appointment-1" });

    expect(send).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
      clinicId: "clinic-1",
      recipient: {
        id: "contact-1",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      type: "manual-confirmation",
    });
    expect(recordMessageDelivery).toHaveBeenCalledWith({
      actorIdentityId: "operator-1",
      appointmentId: "appointment-1",
      clinicId: "clinic-1",
      recipientContactId: "contact-1",
      result: "sent",
      type: "manual-confirmation",
    });
  });

  it("conserva la Cita creada y registra el fallo cuando no se puede enviar su confirmación", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new Error("Proveedor no disponible"));
    const recordMessageDelivery = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({
      id: "appointment-1",
      startsAt: new Date("2026-08-10T14:00:00.000Z"),
      transactionalMessage: {
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50371234567" },
        type: "manual-confirmation",
      },
    });

    await expect(
      createManualAppointment(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          identityId: "operator-1",
          notificationRecipientContactId: "contact-1",
          patientId: "patient-1",
          serviceOfferId: "offer-1",
          startsAt: new Date("2026-08-10T14:00:00.000Z"),
        },
        { create, recordMessageDelivery },
        new Date("2026-08-01T00:00:00.000Z"),
        { send },
      ),
    ).resolves.toMatchObject({ id: "appointment-1" });

    expect(recordMessageDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "failed",
        type: "manual-confirmation",
      }),
    );
  });

  it("solicita a la Agenda crear una Cita futura para el Paciente, Médico y Oferta seleccionados", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "appointment-1",
      startsAt: new Date("2026-08-10T14:00:00.000Z"),
    });

    await expect(
      createManualAppointment(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          identityId: "operator-1",
          patientId: "patient-1",
          serviceOfferId: "offer-1",
          startsAt: new Date("2026-08-10T14:00:00.000Z"),
        },
        { create },
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      id: "appointment-1",
      startsAt: new Date("2026-08-10T14:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      identityId: "operator-1",
      patientId: "patient-1",
      serviceOfferId: "offer-1",
      startsAt: new Date("2026-08-10T14:00:00.000Z"),
    });
  });

  it("rechaza un inicio pasado o fuera de la cuadrícula de cinco minutos antes de reservar capacidad", async () => {
    const create = vi.fn();
    const input = {
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      identityId: "operator-1",
      patientId: "patient-1",
      serviceOfferId: "offer-1",
    };
    const now = new Date("2026-08-10T14:00:00.000Z");

    await expect(
      createManualAppointment(
        { ...input, startsAt: new Date("2026-08-10T13:55:00.000Z") },
        { create },
        now,
      ),
    ).rejects.toThrow("La Cita manual debe iniciar en el futuro");
    await expect(
      createManualAppointment(
        { ...input, startsAt: new Date("2026-08-10T14:01:00.000Z") },
        { create },
        now,
      ),
    ).rejects.toThrow(
      "La Cita manual debe iniciar en la cuadrícula de cinco minutos",
    );

    expect(create).not.toHaveBeenCalled();
  });

  it("no crea ni mueve una Cita cuando la Agenda ya no autoriza esa Opción", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const startsAt = new Date("2026-08-10T14:00:00.000Z");

    await expect(
      createManualAppointment(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          identityId: "operator-1",
          patientId: "patient-1",
          serviceOfferId: "offer-1",
          startsAt,
        },
        { create },
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow(
      "La Cita manual ya no es una Opción de atención autorizada",
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ startsAt }));
  });

  it("exige una confirmación explícita antes de crear una Cita fuera del Horario vigente", async () => {
    const input = {
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      identityId: "operator-1",
      patientId: "patient-1",
      serviceOfferId: "offer-1",
      startsAt: new Date("2026-08-10T20:00:00.000Z"),
    };
    const create = vi
      .fn()
      .mockResolvedValueOnce({ requiresOutsideScheduleConfirmation: true })
      .mockResolvedValueOnce({ id: "appointment-1", startsAt: input.startsAt });

    await expect(
      createManualAppointment(
        input,
        { create },
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(
      ManualAppointmentOutsideScheduleConfirmationRequiredError,
    );
    await expect(
      createManualAppointment(
        { ...input, outsideScheduleConfirmed: true },
        { create },
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({ id: "appointment-1", startsAt: input.startsAt });
  });
});

describe("cancelar una Cita manual", () => {
  it("envía y registra un aviso de cancelación al Contacto vinculado elegido", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const recordMessageDelivery = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue({
      id: "appointment-1",
      status: "cancelled",
      transactionalMessage: {
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        recipient: {
          id: "contact-1",
          name: "Ana Martínez",
          phoneE164: "+50371234567",
        },
        type: "manual-cancellation",
      },
    });

    await expect(
      cancelManualAppointment(
        {
          appointmentId: "appointment-1",
          clinicId: "clinic-1",
          identityId: "operator-1",
          notificationRecipientContactId: "contact-1",
        },
        { cancel, recordMessageDelivery },
        new Date("2026-08-01T00:00:00.000Z"),
        { send },
      ),
    ).resolves.toMatchObject({ id: "appointment-1", status: "cancelled" });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "manual-cancellation" }),
    );
    expect(recordMessageDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ result: "sent", type: "manual-cancellation" }),
    );
  });

  it("registra la cancelación futura con la razón normalizada", async () => {
    const cancel = vi.fn().mockResolvedValue({
      id: "appointment-1",
      status: "cancelled",
    });

    await expect(
      cancelManualAppointment(
        {
          appointmentId: "appointment-1",
          clinicId: "clinic-1",
          identityId: "operator-1",
          reason: "  Paciente  solicitó cancelar ",
        },
        { cancel },
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({ id: "appointment-1", status: "cancelled" });

    expect(cancel).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
      clinicId: "clinic-1",
      identityId: "operator-1",
      now: new Date("2026-08-01T00:00:00.000Z"),
      reason: "Paciente solicitó cancelar",
    });
  });

  it("rechaza una Cita iniciada, pasada o ajena que el almacén no puede cancelar", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);

    await expect(
      cancelManualAppointment(
        {
          appointmentId: "appointment-1",
          clinicId: "clinic-1",
          identityId: "operator-1",
        },
        { cancel },
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(ManualAppointmentNotCancellableError);
  });
});
