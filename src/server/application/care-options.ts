import { CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import {
  normalizeWeeklyPeriods,
  type WeeklyPeriod,
} from "~/server/application/availability";

export type CareOption = { startsAt: Date };

export type CareOptionsRequest = {
  clinicId: string;
  doctorId: string;
  from: string;
  identityId: string;
  serviceId: string;
  to: string;
};

export type CareOptionsStore = {
  find(input: CareOptionsRequest): Promise<CareOptionInputs | undefined>;
};

export type CareOptionInputs = {
  appointments: OccupiedInterval[];
  blocks: OccupiedInterval[];
  offer: { bufferMinutes: number; durationMinutes: number };
  schedules: EffectiveScheduleForOptions[];
  temporaryReservations: TemporaryReservation[];
};

export type EffectiveScheduleForOptions = {
  effectiveFrom: string;
  effectiveUntil: string | null;
  periods: WeeklyPeriod[];
};

export type OccupiedInterval = { endsAt: Date; startsAt: Date };
export type TemporaryReservation = OccupiedInterval & { expiresAt: Date };

/**
 * La Agenda deriva Opciones al vuelo desde la configuración vigente; no hay slots
 * materializados que otra interfaz pueda alterar o reutilizar fuera de esta regla.
 */
export async function calculateCareOptions(
  input: CareOptionsRequest,
  store: CareOptionsStore,
  now = new Date(),
): Promise<CareOption[]> {
  const from = requiredLocalDate(input.from);
  const to = requiredLocalDate(input.to);
  if (from > to)
    throw new Error("El rango de Opciones debe respetar el calendario local");

  const available = await store.find(input);
  if (available === undefined) return [];

  const occupied = [
    ...available.blocks,
    ...available.appointments,
    ...available.temporaryReservations.filter(
      (reservation) => reservation.expiresAt > now,
    ),
  ];
  const totalMinutes =
    available.offer.durationMinutes + available.offer.bufferMinutes;
  const options: CareOption[] = [];

  for (const date of localDates(from, to)) {
    for (const period of effectivePeriods(available.schedules, date)) {
      const startsAtMinute = ceilToGrid(minutes(period.startTime));
      const endsAtMinute = minutes(period.endTime);
      for (
        let startMinute = startsAtMinute;
        startMinute + totalMinutes <= endsAtMinute;
        startMinute += 5
      ) {
        const startsAt = localDateTime(date, startMinute);
        const blockedUntil = new Date(
          startsAt.valueOf() + totalMinutes * 60_000,
        );
        if (
          !occupied.some((interval) =>
            overlaps(startsAt, blockedUntil, interval),
          )
        ) {
          options.push({ startsAt });
        }
      }
    }
  }
  return options;
}

function effectivePeriods(
  schedules: EffectiveScheduleForOptions[],
  date: string,
) {
  const dayOfWeek = new Date(
    `${date}T00:00:00${CLINIC_UTC_OFFSET}`,
  ).getUTCDay();
  const periods = schedules
    .filter(
      (schedule) =>
        schedule.effectiveFrom <= date &&
        (schedule.effectiveUntil === null || schedule.effectiveUntil >= date),
    )
    .flatMap((schedule) =>
      schedule.periods.filter((period) => period.dayOfWeek === dayOfWeek),
    )
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
  return periods.length === 0 ? [] : normalizeWeeklyPeriods(periods);
}

function overlaps(start: Date, end: Date, interval: OccupiedInterval) {
  return start < interval.endsAt && end > interval.startsAt;
}

function requiredLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("El rango de Opciones debe usar fechas locales válidas");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("El rango de Opciones debe usar fechas locales válidas");
  }
  return value;
}

function* localDates(from: string, to: string) {
  const date = new Date(`${from}T00:00:00.000Z`);
  const last = new Date(`${to}T00:00:00.000Z`);
  while (date <= last) {
    yield date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function ceilToGrid(value: number) {
  return Math.ceil(value / 5) * 5;
}

function localDateTime(date: string, minuteOfDay: number) {
  const hours = Math.floor(minuteOfDay / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (minuteOfDay % 60).toString().padStart(2, "0");
  return new Date(`${date}T${hours}:${minutes}:00${CLINIC_UTC_OFFSET}`);
}
