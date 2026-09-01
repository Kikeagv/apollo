import { describe, expect, it } from "vitest";

import {
  calendarDates,
  calendarEntryEnd,
  calendarPeriodFor,
  calendarKeyboardMinute,
  calendarSegments,
  parseCalendarDate,
  shiftCalendarKeyboardMinute,
} from "./panacea-calendar";

describe("dominio temporal del Calendario de Panacea", () => {
  it("conserva la fecha al cambiar entre semana y día y calcula el período local", () => {
    expect(calendarDates("2026-08-12", "day")).toEqual(["2026-08-12"]);
    expect(calendarDates("2026-08-12", "week")).toEqual([
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
    expect(calendarPeriodFor("2026-08-12", "day")).toEqual({
      from: new Date("2026-08-12T06:00:00.000Z"),
      to: new Date("2026-08-13T06:00:00.000Z"),
    });
  });

  it("rechaza fechas de ruta inválidas y usa un fallback válido", () => {
    expect(parseCalendarDate("2026-02-30", "2026-08-12")).toBe("2026-08-12");
    expect(parseCalendarDate("2026-08-12", "2026-08-01")).toBe("2026-08-12");
    expect(parseCalendarDate(undefined, "2026-08-01")).toBe("2026-08-01");
  });

  it("posiciona el período ocupado completo, incluido el buffer cotizado", () => {
    const entry = {
      endsAt: new Date("2026-08-12T20:30:00.000Z"),
      id: "appointment-1",
      occupiedUntil: new Date("2026-08-12T20:45:00.000Z"),
      startsAt: new Date("2026-08-12T20:00:00.000Z"),
    };

    expect(calendarEntryEnd(entry)).toEqual(entry.occupiedUntil);
    expect(
      calendarSegments([entry], ["2026-08-12"], {
        endMinute: 18 * 60,
        startMinute: 12 * 60,
      }),
    ).toEqual([
      expect.objectContaining({
        date: "2026-08-12",
        entry,
        heightPercent: 12.5,
        topPercent: 33.33333333333333,
      }),
    ]);
  });

  it("divide un período que cruza medianoche entre las columnas correspondientes", () => {
    const entry = {
      endsAt: new Date("2026-08-13T06:30:00.000Z"),
      id: "block-1",
      startsAt: new Date("2026-08-13T05:30:00.000Z"),
    };

    expect(
      calendarSegments([entry], ["2026-08-12", "2026-08-13"], {
        endMinute: 24 * 60,
        startMinute: 0,
      }).map(({ date, heightPercent, topPercent }) => ({
        date,
        heightPercent,
        topPercent,
      })),
    ).toEqual([
      {
        date: "2026-08-12",
        heightPercent: 2.083333333333333,
        topPercent: 97.91666666666666,
      },
      {
        date: "2026-08-13",
        heightPercent: 2.083333333333333,
        topPercent: 0,
      },
    ]);
  });

  it("asigna carriles para que las colisiones del mismo Médico sigan visibles", () => {
    const segments = calendarSegments(
      [
        {
          endsAt: new Date("2026-08-12T21:00:00.000Z"),
          id: "appointment-1",
          startsAt: new Date("2026-08-12T20:00:00.000Z"),
        },
        {
          endsAt: new Date("2026-08-12T21:30:00.000Z"),
          id: "block-1",
          startsAt: new Date("2026-08-12T20:30:00.000Z"),
        },
      ],
      ["2026-08-12"],
      { endMinute: 18 * 60, startMinute: 12 * 60 },
    );

    expect(
      segments.map(({ entry, lane, laneCount }) => ({
        id: entry.id,
        lane,
        laneCount,
      })),
    ).toEqual([
      { id: "appointment-1", lane: 0, laneCount: 2 },
      { id: "block-1", lane: 1, laneCount: 2 },
    ]);
  });

  it("mantiene la selección accesible dentro de la cuadrícula de 5 minutos", () => {
    const bounds = { endMinute: 17 * 60 + 10, startMinute: 7 * 60 + 5 };

    expect(calendarKeyboardMinute(undefined, bounds)).toBe(9 * 60);
    expect(calendarKeyboardMinute(7 * 60, bounds)).toBe(7 * 60 + 5);
    expect(calendarKeyboardMinute(18 * 60, bounds)).toBe(17 * 60 + 5);
    expect(shiftCalendarKeyboardMinute(9 * 60, bounds, "previous")).toBe(
      8 * 60 + 55,
    );
    expect(shiftCalendarKeyboardMinute(9 * 60, bounds, "next")).toBe(
      9 * 60 + 5,
    );
  });
});
