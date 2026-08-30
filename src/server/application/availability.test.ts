import { describe, expect, it, vi } from "vitest";

import {
  configureEffectiveSchedule,
  createAvailabilityBlock,
  createAvailabilityBlocks,
} from "./availability";

describe("configurar Horarios vigentes", () => {
  it("une franjas traslapadas del mismo día local antes de persistir la nueva vigencia", async () => {
    const replace = vi.fn().mockResolvedValue({
      effectiveFrom: "2026-08-10",
      id: "schedule-2",
      effectiveUntil: null,
      periods: [
        { dayOfWeek: 1, endTime: "12:00", startTime: "08:00" },
        { dayOfWeek: 1, endTime: "17:00", startTime: "14:00" },
      ],
    });

    await expect(
      configureEffectiveSchedule(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          effectiveFrom: "2026-08-10",
          identityId: "owner-1",
          periods: [
            { dayOfWeek: 1, endTime: "10:30", startTime: "08:00" },
            { dayOfWeek: 1, endTime: "12:00", startTime: "10:00" },
            { dayOfWeek: 1, endTime: "17:00", startTime: "14:00" },
          ],
        },
        { replace },
      ),
    ).resolves.toMatchObject({ id: "schedule-2" });

    expect(replace).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      effectiveFrom: "2026-08-10",
      identityId: "owner-1",
      periods: [
        { dayOfWeek: 1, endTime: "12:00", startTime: "08:00" },
        { dayOfWeek: 1, endTime: "17:00", startTime: "14:00" },
      ],
      timezone: "America/El_Salvador",
    });
  });

  it("rechaza una franja que cruza medianoche", async () => {
    const replace = vi.fn();

    await expect(
      configureEffectiveSchedule(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          effectiveFrom: "2026-08-10",
          identityId: "owner-1",
          periods: [{ dayOfWeek: 1, endTime: "01:00", startTime: "22:00" }],
        },
        { replace },
      ),
    ).rejects.toThrow("Una franja no puede cruzar medianoche");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("crear Bloqueos", () => {
  it("normaliza la etiqueta privada y conserva el intervalo local de la Clínica", async () => {
    const create = vi.fn().mockResolvedValue({
      doctorId: "doctor-1",
      endsAt: new Date("2026-08-12T16:00:00.000Z"),
      id: "block-1",
      privateLabel: "Vacaciones",
      startsAt: new Date("2026-08-12T14:00:00.000Z"),
    });

    await expect(
      createAvailabilityBlock(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          endsAt: new Date("2026-08-12T16:00:00.000Z"),
          identityId: "doctor-identity-1",
          privateLabel: "  Vacaciones  ",
          startsAt: new Date("2026-08-12T14:00:00.000Z"),
        },
        { create },
      ),
    ).resolves.toMatchObject({ id: "block-1", privateLabel: "Vacaciones" });

    expect(create).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      endsAt: new Date("2026-08-12T16:00:00.000Z"),
      identityId: "doctor-identity-1",
      privateLabel: "Vacaciones",
      startsAt: new Date("2026-08-12T14:00:00.000Z"),
      timezone: "America/El_Salvador",
    });
  });

  it("rechaza un Bloqueo que cruza medianoche de America/El_Salvador", async () => {
    const create = vi.fn();

    await expect(
      createAvailabilityBlock(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          endsAt: new Date("2026-08-13T06:30:00.000Z"),
          identityId: "doctor-identity-1",
          privateLabel: undefined,
          startsAt: new Date("2026-08-13T05:30:00.000Z"),
        },
        { create },
      ),
    ).rejects.toThrow("Un Bloqueo no puede cruzar medianoche");
    expect(create).not.toHaveBeenCalled();
  });

  it("convierte un Bloqueo masivo en Bloqueos individuales", async () => {
    const createMany = vi.fn().mockResolvedValue([
      {
        doctorId: "doctor-1",
        endsAt: new Date("2026-08-12T16:00:00.000Z"),
        id: "block-1",
        privateLabel: null,
        startsAt: new Date("2026-08-12T14:00:00.000Z"),
      },
      {
        doctorId: "doctor-2",
        endsAt: new Date("2026-08-12T16:00:00.000Z"),
        id: "block-2",
        privateLabel: null,
        startsAt: new Date("2026-08-12T14:00:00.000Z"),
      },
    ]);

    await expect(
      createAvailabilityBlocks(
        {
          clinicId: "clinic-1",
          doctorIds: ["doctor-1", "doctor-2"],
          endsAt: new Date("2026-08-12T16:00:00.000Z"),
          identityId: "owner-1",
          startsAt: new Date("2026-08-12T14:00:00.000Z"),
        },
        { createMany },
      ),
    ).resolves.toHaveLength(2);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorIds: ["doctor-1", "doctor-2"],
        privateLabel: null,
        timezone: "America/El_Salvador",
      }),
    );
  });
});
