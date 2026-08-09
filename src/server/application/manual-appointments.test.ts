import { describe, expect, it, vi } from "vitest";

import {
  createManualAppointment,
  ManualAppointmentOutsideScheduleConfirmationRequiredError,
} from "./manual-appointments";

describe("crear una Cita manual", () => {
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
