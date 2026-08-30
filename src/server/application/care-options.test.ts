import { describe, expect, it } from "vitest";

import { calculateCareOptions } from "./care-options";

describe("calcular Opciones de atención", () => {
  it("ofrece solo inicios en la cuadrícula cuando duración y buffer caben en el Horario vigente", async () => {
    const options = await calculateCareOptions(
      {
        clinicId: "clinic-1",
        doctorId: "doctor-1",
        from: "2026-08-03",
        identityId: "owner-1",
        serviceId: "service-1",
        to: "2026-08-03",
      },
      {
        find: async () => ({
          blocks: [],
          offer: { bufferMinutes: 15, durationMinutes: 30 },
          schedules: [
            {
              effectiveFrom: "2026-08-01",
              effectiveUntil: null,
              periods: [{ dayOfWeek: 1, endTime: "09:00", startTime: "08:00" }],
            },
          ],
          appointments: [],
          temporaryReservations: [],
        }),
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(options).toEqual([
      { startsAt: new Date("2026-08-03T14:00:00.000Z") },
      { startsAt: new Date("2026-08-03T14:05:00.000Z") },
      { startsAt: new Date("2026-08-03T14:10:00.000Z") },
      { startsAt: new Date("2026-08-03T14:15:00.000Z") },
    ]);
  });

  it("respeta la vigencia local y une Horarios traslapados sin crear capacidad paralela", async () => {
    const options = await calculateCareOptions(
      {
        clinicId: "clinic-1",
        doctorId: "doctor-1",
        from: "2026-08-03",
        identityId: "owner-1",
        serviceId: "service-1",
        to: "2026-08-10",
      },
      {
        find: async () => ({
          appointments: [],
          blocks: [],
          offer: { bufferMinutes: 0, durationMinutes: 30 },
          schedules: [
            {
              effectiveFrom: "2026-08-04",
              effectiveUntil: null,
              periods: [
                { dayOfWeek: 1, endTime: "09:00", startTime: "08:00" },
                { dayOfWeek: 1, endTime: "10:00", startTime: "08:30" },
              ],
            },
          ],
          temporaryReservations: [],
        }),
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(options).toEqual([
      { startsAt: new Date("2026-08-10T14:00:00.000Z") },
      { startsAt: new Date("2026-08-10T14:05:00.000Z") },
      { startsAt: new Date("2026-08-10T14:10:00.000Z") },
      { startsAt: new Date("2026-08-10T14:15:00.000Z") },
      { startsAt: new Date("2026-08-10T14:20:00.000Z") },
      { startsAt: new Date("2026-08-10T14:25:00.000Z") },
      { startsAt: new Date("2026-08-10T14:30:00.000Z") },
      { startsAt: new Date("2026-08-10T14:35:00.000Z") },
      { startsAt: new Date("2026-08-10T14:40:00.000Z") },
      { startsAt: new Date("2026-08-10T14:45:00.000Z") },
      { startsAt: new Date("2026-08-10T14:50:00.000Z") },
      { startsAt: new Date("2026-08-10T14:55:00.000Z") },
      { startsAt: new Date("2026-08-10T15:00:00.000Z") },
      { startsAt: new Date("2026-08-10T15:05:00.000Z") },
      { startsAt: new Date("2026-08-10T15:10:00.000Z") },
      { startsAt: new Date("2026-08-10T15:15:00.000Z") },
      { startsAt: new Date("2026-08-10T15:20:00.000Z") },
      { startsAt: new Date("2026-08-10T15:25:00.000Z") },
      { startsAt: new Date("2026-08-10T15:30:00.000Z") },
    ]);
  });

  it("excluye Bloqueos y Citas confirmadas que tocan el período completo", async () => {
    const options = await calculateCareOptions(
      {
        clinicId: "clinic-1",
        doctorId: "doctor-1",
        from: "2026-08-03",
        identityId: "owner-1",
        serviceId: "service-1",
        to: "2026-08-03",
      },
      {
        find: async () => ({
          appointments: [
            {
              endsAt: new Date("2026-08-03T15:30:00.000Z"),
              startsAt: new Date("2026-08-03T15:00:00.000Z"),
            },
          ],
          blocks: [
            {
              endsAt: new Date("2026-08-03T14:45:00.000Z"),
              startsAt: new Date("2026-08-03T14:15:00.000Z"),
            },
          ],
          offer: { bufferMinutes: 0, durationMinutes: 15 },
          schedules: [
            {
              effectiveFrom: "2026-08-01",
              effectiveUntil: null,
              periods: [{ dayOfWeek: 1, endTime: "10:00", startTime: "08:00" }],
            },
          ],
          temporaryReservations: [],
        }),
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(options.map((option) => option.startsAt.toISOString())).toEqual([
      "2026-08-03T14:00:00.000Z",
      "2026-08-03T14:45:00.000Z",
      "2026-08-03T15:30:00.000Z",
      "2026-08-03T15:35:00.000Z",
      "2026-08-03T15:40:00.000Z",
      "2026-08-03T15:45:00.000Z",
    ]);
  });

  it("mantiene libre una Reserva temporal vencida y excluye una activa", async () => {
    const options = await calculateCareOptions(
      {
        clinicId: "clinic-1",
        doctorId: "doctor-1",
        from: "2026-08-03",
        identityId: "owner-1",
        serviceId: "service-1",
        to: "2026-08-03",
      },
      {
        find: async () => ({
          appointments: [],
          blocks: [],
          offer: { bufferMinutes: 0, durationMinutes: 15 },
          schedules: [
            {
              effectiveFrom: "2026-08-01",
              effectiveUntil: null,
              periods: [{ dayOfWeek: 1, endTime: "09:00", startTime: "08:00" }],
            },
          ],
          temporaryReservations: [
            {
              endsAt: new Date("2026-08-03T14:30:00.000Z"),
              expiresAt: new Date("2026-08-03T13:59:00.000Z"),
              startsAt: new Date("2026-08-03T14:15:00.000Z"),
            },
            {
              endsAt: new Date("2026-08-03T14:45:00.000Z"),
              expiresAt: new Date("2026-08-03T16:00:00.000Z"),
              startsAt: new Date("2026-08-03T14:30:00.000Z"),
            },
          ],
        }),
      },
      new Date("2026-08-03T13:59:00.000Z"),
    );

    expect(options.map((option) => option.startsAt.toISOString())).toEqual([
      "2026-08-03T14:00:00.000Z",
      "2026-08-03T14:05:00.000Z",
      "2026-08-03T14:10:00.000Z",
      "2026-08-03T14:15:00.000Z",
      "2026-08-03T14:45:00.000Z",
    ]);
  });

  it("no produce Opciones cuando el Médico o la Oferta no son elegibles", async () => {
    await expect(
      calculateCareOptions(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-without-capacity",
          from: "2026-08-03",
          identityId: "owner-1",
          serviceId: "service-1",
          to: "2026-08-03",
        },
        { find: async () => undefined },
      ),
    ).resolves.toEqual([]);
  });

  it("no ofrece inicios que ya quedaron en el pasado", async () => {
    const options = await calculateCareOptions(
      {
        clinicId: "clinic-1",
        doctorId: "doctor-1",
        from: "2026-08-03",
        identityId: "owner-1",
        serviceId: "service-1",
        to: "2026-08-03",
      },
      {
        find: async () => ({
          appointments: [],
          blocks: [],
          offer: { bufferMinutes: 0, durationMinutes: 15 },
          schedules: [
            {
              effectiveFrom: "2026-08-01",
              effectiveUntil: null,
              periods: [{ dayOfWeek: 1, endTime: "09:00", startTime: "08:00" }],
            },
          ],
          temporaryReservations: [],
        }),
      },
      new Date("2026-08-03T14:10:00.000Z"),
    );

    expect(options.map((option) => option.startsAt.toISOString())).toEqual([
      "2026-08-03T14:15:00.000Z",
      "2026-08-03T14:20:00.000Z",
      "2026-08-03T14:25:00.000Z",
      "2026-08-03T14:30:00.000Z",
      "2026-08-03T14:35:00.000Z",
      "2026-08-03T14:40:00.000Z",
      "2026-08-03T14:45:00.000Z",
    ]);
  });
});
