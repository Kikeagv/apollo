const CLINIC_TIMEZONE = "America/El_Salvador";
const MAX_PRIVATE_LABEL_LENGTH = 160;

export type WeeklyPeriod = {
  dayOfWeek: number;
  endTime: string;
  startTime: string;
};

export type EffectiveSchedule = {
  effectiveFrom: string;
  effectiveUntil: string | null;
  id: string;
  periods: WeeklyPeriod[];
};

export type EffectiveScheduleReplacer = {
  replace(input: {
    clinicId: string;
    doctorId: string;
    effectiveFrom: string;
    identityId: string;
    periods: WeeklyPeriod[];
    timezone: typeof CLINIC_TIMEZONE;
  }): Promise<EffectiveSchedule | undefined>;
};

export type AvailabilityBlock = {
  endsAt: Date;
  id: string;
  privateLabel: string | null;
  startsAt: Date;
};

export type AvailabilityBlockCreator = {
  create(input: {
    clinicId: string;
    doctorId: string;
    endsAt: Date;
    identityId: string;
    privateLabel: string | null;
    startsAt: Date;
    timezone: typeof CLINIC_TIMEZONE;
  }): Promise<AvailabilityBlock | undefined>;
};

export type AvailabilityBlockBatchCreator = {
  createMany(input: {
    clinicId: string;
    doctorIds: string[];
    endsAt: Date;
    identityId: string;
    privateLabel: string | null;
    startsAt: Date;
    timezone: typeof CLINIC_TIMEZONE;
  }): Promise<AvailabilityBlock[] | undefined>;
};

export class AvailabilityAccessError extends Error {
  constructor() {
    super("La Identidad no puede configurar esta disponibilidad");
    this.name = "AvailabilityAccessError";
  }
}

/** Reemplaza la regla recurrente futura y conserva la vigencia histórica. */
export async function configureEffectiveSchedule(
  input: {
    clinicId: string;
    doctorId: string;
    effectiveFrom: string;
    identityId: string;
    periods: WeeklyPeriod[];
  },
  store: EffectiveScheduleReplacer,
) {
  const schedule = await store.replace({
    ...input,
    effectiveFrom: requiredDate(input.effectiveFrom),
    periods: normalizeWeeklyPeriods(input.periods),
    timezone: CLINIC_TIMEZONE,
  });
  if (schedule === undefined) throw new AvailabilityAccessError();
  return schedule;
}

/** Crea una excepción puntual sin exponer su etiqueta fuera de Panacea. */
export async function createAvailabilityBlock(
  input: {
    clinicId: string;
    doctorId: string;
    endsAt: Date;
    identityId: string;
    privateLabel?: string;
    startsAt: Date;
  },
  store: AvailabilityBlockCreator,
) {
  const checked = await validateBlockInput(input);
  const block = await store.create({
    ...input,
    ...checked,
    timezone: CLINIC_TIMEZONE,
  });
  if (block === undefined) throw new AvailabilityAccessError();
  return block;
}

/** El propietario convierte un Bloqueo masivo en Bloqueos individuales. */
export async function createAvailabilityBlocks(
  input: {
    clinicId: string;
    doctorIds: string[];
    endsAt: Date;
    identityId: string;
    privateLabel?: string;
    startsAt: Date;
  },
  store: AvailabilityBlockBatchCreator,
) {
  if (new Set(input.doctorIds).size !== input.doctorIds.length || input.doctorIds.length === 0) {
    throw new Error("Seleccione uno o más Médicos distintos");
  }
  const checked = await validateBlockInput(input);
  const blocks = await store.createMany({
    ...input,
    ...checked,
    timezone: CLINIC_TIMEZONE,
  });
  if (blocks === undefined) throw new AvailabilityAccessError();
  return blocks;
}

export function normalizeWeeklyPeriods(periods: WeeklyPeriod[]) {
  if (periods.length === 0) {
    throw new Error("El Horario vigente requiere al menos una franja");
  }
  const normalized = periods.map((period) => ({
    dayOfWeek: validDay(period.dayOfWeek),
    endTime: validTime(period.endTime, "El fin de la franja"),
    startTime: validTime(period.startTime, "El inicio de la franja"),
  }));
  for (const period of normalized) {
    if (period.startTime >= period.endTime) {
      throw new Error("Una franja no puede cruzar medianoche");
    }
  }
  return normalized
    .sort((left, right) =>
      left.dayOfWeek === right.dayOfWeek
        ? left.startTime.localeCompare(right.startTime)
        : left.dayOfWeek - right.dayOfWeek,
    )
    .reduce<WeeklyPeriod[]>((merged, period) => {
      const previous = merged.at(-1);
      if (
        previous?.dayOfWeek === period.dayOfWeek &&
        previous !== undefined &&
        period.startTime <= previous.endTime
      ) {
        previous.endTime =
          previous.endTime > period.endTime ? previous.endTime : period.endTime;
        return merged;
      }
      merged.push(period);
      return merged;
    }, []);
}

function requiredDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("La vigencia debe expresarse como una fecha local válida");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("La vigencia debe expresarse como una fecha local válida");
  }
  return value;
}

function validDay(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error("El día de semana debe estar entre 0 y 6");
  }
  return value;
}

function validTime(value: string, label: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${label} debe expresarse como HH:MM`);
  }
  return value;
}

function optionalText(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_PRIVATE_LABEL_LENGTH) {
    throw new Error(
      `La etiqueta privada no puede exceder ${MAX_PRIVATE_LABEL_LENGTH} caracteres`,
    );
  }
  return normalized;
}

async function validateBlockInput(input: {
  endsAt: Date;
  privateLabel?: string;
  startsAt: Date;
}) {
  if (Number.isNaN(input.startsAt?.valueOf())) {
    throw new Error("El inicio del Bloqueo debe ser válido");
  }
  if (Number.isNaN(input.endsAt?.valueOf())) {
    throw new Error("El fin del Bloqueo debe ser válido");
  }
  if (input.startsAt >= input.endsAt) {
    throw new Error("El Bloqueo debe terminar después de iniciar");
  }
  if (localDate(input.startsAt) !== localDate(input.endsAt)) {
    throw new Error("Un Bloqueo no puede cruzar medianoche");
  }
  return { privateLabel: optionalText(input.privateLabel) };
}

function localDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
  }).formatToParts(value);
  const part = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find(({ type }) => type === kind)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
