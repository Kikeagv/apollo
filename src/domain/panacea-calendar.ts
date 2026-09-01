import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";

export type CalendarView = "day" | "week";

export type CalendarTimedEntry = {
  endsAt: Date | string;
  id: string;
  occupiedUntil?: Date | string | null;
  startsAt: Date | string;
};

export type CalendarGridBounds = {
  endMinute: number;
  startMinute: number;
};

export type CalendarEntrySegment<T extends CalendarTimedEntry> = {
  date: string;
  endsAt: Date;
  entry: T;
  heightPercent: number;
  lane: number;
  laneCount: number;
  startsAt: Date;
  topPercent: number;
};

const DEFAULT_GRID_BOUNDS: CalendarGridBounds = {
  endMinute: 21 * 60,
  startMinute: 7 * 60,
};

export function parseCalendarDate(
  value: string | null | undefined,
  fallback: string,
) {
  return isCalendarDate(value) ? value : fallback;
}

export function calendarDates(date: string, view: CalendarView) {
  if (!isCalendarDate(date)) {
    throw new Error("El Calendario requiere una fecha local válida");
  }
  if (view === "day") return [date];

  const weekStart = new Date(`${date}T00:00:00.000Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

export function calendarPeriodFor(date: string, view: CalendarView) {
  const dates = calendarDates(date, view);
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  if (firstDate === undefined || lastDate === undefined) {
    throw new Error("El Calendario requiere al menos un día visible");
  }

  return {
    from: clinicMidnight(firstDate),
    to: clinicMidnight(nextLocalDate(lastDate)),
  };
}

export function calendarEntryEnd(entry: CalendarTimedEntry) {
  return toDate(entry.occupiedUntil ?? entry.endsAt);
}

export function calendarGridBounds(
  entries: readonly CalendarTimedEntry[],
): CalendarGridBounds {
  let startMinute = DEFAULT_GRID_BOUNDS.startMinute;
  let endMinute = DEFAULT_GRID_BOUNDS.endMinute;

  for (const entry of entries) {
    const startsAt = toDate(entry.startsAt);
    const endsAt = calendarEntryEnd(entry);
    if (endsAt <= startsAt) continue;

    if (localDate(startsAt) !== localDate(endsAt)) {
      return { endMinute: 24 * 60, startMinute: 0 };
    }

    startMinute = Math.min(startMinute, floorToHour(localMinute(startsAt)));
    endMinute = Math.max(endMinute, ceilToHour(localMinute(endsAt)));
  }

  return { endMinute, startMinute };
}

/** Normaliza una hora de teclado al primer y último inicio de slot de 5 minutos. */
export function calendarKeyboardMinute(
  minute: number | undefined,
  bounds: CalendarGridBounds,
) {
  const firstSlot = ceilToStep(bounds.startMinute, 5);
  const lastSlot = Math.max(firstSlot, floorToStep(bounds.endMinute - 5, 5));
  const preferredMinute = minute ?? 9 * 60;
  const normalizedMinute = Math.round(preferredMinute / 5) * 5;
  return Math.min(lastSlot, Math.max(firstSlot, normalizedMinute));
}

/** Desplaza el contexto de creación con las flechas sin salir de la cuadrícula. */
export function shiftCalendarKeyboardMinute(
  minute: number | undefined,
  bounds: CalendarGridBounds,
  direction: "next" | "previous",
) {
  const delta = direction === "next" ? 5 : -5;
  return calendarKeyboardMinute(
    calendarKeyboardMinute(minute, bounds) + delta,
    bounds,
  );
}

export function calendarSegments<T extends CalendarTimedEntry>(
  entries: readonly T[],
  dates: readonly string[],
  bounds: CalendarGridBounds,
): CalendarEntrySegment<T>[] {
  const range = bounds.endMinute - bounds.startMinute;
  if (range <= 0) throw new Error("La cuadrícula requiere un rango válido");

  return dates.flatMap((date) => {
    const dayStart = clinicMidnight(date);
    const dayEnd = clinicMidnight(nextLocalDate(date));

    const daySegments = entries.flatMap((entry) => {
      const entryStart = toDate(entry.startsAt);
      const entryEnd = calendarEntryEnd(entry);
      if (entryEnd <= entryStart) return [];

      const startsAt = new Date(
        Math.max(entryStart.valueOf(), dayStart.valueOf()),
      );
      const endsAt = new Date(Math.min(entryEnd.valueOf(), dayEnd.valueOf()));
      if (startsAt >= endsAt) return [];

      const startMinute = Math.max(bounds.startMinute, localMinute(startsAt));
      const endMinute = Math.min(
        bounds.endMinute,
        localDate(endsAt) === date ? localMinute(endsAt) : 24 * 60,
      );
      if (startMinute >= endMinute) return [];

      return [
        {
          date,
          endsAt,
          entry,
          heightPercent: ((endMinute - startMinute) / range) * 100,
          startsAt,
          topPercent: ((startMinute - bounds.startMinute) / range) * 100,
        },
      ];
    });

    const laneEnds: number[] = [];
    const assignedSegments = daySegments
      .sort(
        (left, right) =>
          left.startsAt.valueOf() - right.startsAt.valueOf() ||
          left.endsAt.valueOf() - right.endsAt.valueOf() ||
          left.entry.id.localeCompare(right.entry.id),
      )
      .map((segment) => {
        const lane = laneEnds.findIndex(
          (laneEnd) => laneEnd <= segment.startsAt.valueOf(),
        );
        const assignedLane = lane === -1 ? laneEnds.length : lane;
        laneEnds[assignedLane] = segment.endsAt.valueOf();
        return { ...segment, lane: assignedLane };
      });

    return assignedSegments.map((segment) => ({
      ...segment,
      laneCount: laneEnds.length,
    }));
  });
}

function isCalendarDate(value: string | null | undefined): value is string {
  if (
    value === undefined ||
    value === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function clinicMidnight(date: string) {
  return new Date(`${date}T00:00:00${CLINIC_UTC_OFFSET}`);
}

function nextLocalDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function localDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
  }).formatToParts(value);
  return formatDateParts(parts);
}

function localMinute(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hour * 60 + minute;
}

function formatDateParts(parts: Intl.DateTimeFormatPart[]) {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function floorToHour(value: number) {
  return Math.floor(value / 60) * 60;
}

function ceilToHour(value: number) {
  return Math.ceil(value / 60) * 60;
}

function floorToStep(value: number, step: number) {
  return Math.floor(value / step) * step;
}

function ceilToStep(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function toDate(value: Date | string) {
  return new Date(value);
}
