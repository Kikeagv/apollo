import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import {
  CapacityConflictError,
  type AvailabilityBlock,
  type AvailabilityBlockBatchCreator,
  type AvailabilityBlockCreator,
  type CapacityConflict,
  type EffectiveSchedule,
  type EffectiveScheduleReplacer,
  type WeeklyPeriod,
} from "~/server/application/availability";
import { inClinicTransaction } from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointments,
  availabilityBlocks,
  clinicUsers,
  configurationAuditEvents,
  doctors,
  effectiveSchedulePeriods,
  effectiveSchedules,
  temporaryReservations,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const drizzleAvailabilityStore: EffectiveScheduleReplacer &
  AvailabilityBlockCreator &
  AvailabilityBlockBatchCreator = {
  async replace(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await canManageDoctor(transaction, input))) return undefined;
      await lockDoctor(transaction, input.doctorId);

      const future = await transaction.query.effectiveSchedules.findFirst({
        columns: { effectiveFrom: true },
        orderBy: [effectiveSchedules.effectiveFrom],
        where: and(
          eq(effectiveSchedules.clinicId, input.clinicId),
          eq(effectiveSchedules.doctorId, input.doctorId),
          gt(effectiveSchedules.effectiveFrom, input.effectiveFrom),
        ),
      });

      const current = await transaction.query.effectiveSchedules.findFirst({
        columns: {
          effectiveFrom: true,
          effectiveUntil: true,
          id: true,
        },
        orderBy: [desc(effectiveSchedules.effectiveFrom)],
        where: and(
          eq(effectiveSchedules.clinicId, input.clinicId),
          eq(effectiveSchedules.doctorId, input.doctorId),
          lte(effectiveSchedules.effectiveFrom, input.effectiveFrom),
          or(
            isNull(effectiveSchedules.effectiveUntil),
            gte(effectiveSchedules.effectiveUntil, input.effectiveFrom),
          ),
        ),
      });
      const conflicts = await scheduleConflicts(transaction, {
        ...input,
        effectiveUntil:
          future === undefined ? null : previousLocalDate(future.effectiveFrom),
      });
      if (conflicts.length > 0) throw new CapacityConflictError(conflicts);

      if (current !== undefined) {
        const effectiveUntil = previousLocalDate(input.effectiveFrom);
        if (effectiveUntil < current.effectiveFrom) {
          throw new Error(
            "La nueva vigencia no puede preceder al Horario vigente",
          );
        }
        await transaction
          .update(effectiveSchedules)
          .set({ effectiveUntil })
          .where(eq(effectiveSchedules.id, current.id));
        await transaction.insert(configurationAuditEvents).values({
          action: "effective-schedule-closed",
          actorIdentityId: input.identityId,
          afterValues: { effectiveUntil },
          beforeValues: { effectiveUntil: current.effectiveUntil },
          clinicId: input.clinicId,
          entity: "effective-schedule",
          entityId: current.id,
        });
      }

      const [schedule] = await transaction
        .insert(effectiveSchedules)
        .values({
          clinicId: input.clinicId,
          doctorId: input.doctorId,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil:
            future === undefined
              ? null
              : previousLocalDate(future.effectiveFrom),
          timezone: input.timezone,
        })
        .returning({
          effectiveFrom: effectiveSchedules.effectiveFrom,
          effectiveUntil: effectiveSchedules.effectiveUntil,
          id: effectiveSchedules.id,
        });
      if (schedule === undefined)
        throw new Error("No se pudo crear el Horario vigente");
      await transaction.insert(effectiveSchedulePeriods).values(
        input.periods.map((period) => ({
          ...period,
          clinicId: input.clinicId,
          doctorId: input.doctorId,
          scheduleId: schedule.id,
        })),
      );
      await transaction.insert(configurationAuditEvents).values({
        action: "effective-schedule-created",
        actorIdentityId: input.identityId,
        afterValues: scheduleAuditValues({
          ...schedule,
          periods: input.periods,
        }),
        clinicId: input.clinicId,
        entity: "effective-schedule",
        entityId: schedule.id,
      });
      return { ...schedule, periods: input.periods };
    });
  },

  async create(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await canManageDoctor(transaction, input))) return undefined;
      await lockDoctor(transaction, input.doctorId);
      const conflicts = await intervalConflicts(transaction, input);
      if (conflicts.length > 0) throw new CapacityConflictError(conflicts);
      return insertBlock(transaction, input);
    });
  },

  async createMany(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await isOwner(transaction, input))) return undefined;
      const eligible = await transaction
        .select({ id: doctors.id })
        .from(doctors)
        .where(
          and(
            eq(doctors.clinicId, input.clinicId),
            inArray(doctors.id, input.doctorIds),
          ),
        );
      if (eligible.length !== input.doctorIds.length) return undefined;
      for (const doctorId of input.doctorIds)
        await lockDoctor(transaction, doctorId);
      const conflicts = (
        await Promise.all(
          input.doctorIds.map((doctorId) =>
            intervalConflicts(transaction, { ...input, doctorId }),
          ),
        )
      ).flat();
      if (conflicts.length > 0) throw new CapacityConflictError(conflicts);
      return Promise.all(
        input.doctorIds.map((doctorId) =>
          insertBlock(transaction, { ...input, doctorId }),
        ),
      );
    });
  },
};

/** Datos exclusivos de Panacea; ningún adaptador público devuelve privateLabel. */
export async function listAvailabilityConfiguration(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    const managedDoctors = await transaction
      .select({ id: doctors.id, publicName: doctors.publicName })
      .from(doctors)
      .where(eq(doctors.clinicId, input.clinicId));
    const doctorIds = managedDoctors.map((doctor) => doctor.id);
    if (doctorIds.length === 0)
      return { blocks: [], doctors: [], schedules: [] };
    const [schedules, periods, blocks] = await Promise.all([
      transaction.query.effectiveSchedules.findMany({
        orderBy: [desc(effectiveSchedules.effectiveFrom)],
        where: and(
          eq(effectiveSchedules.clinicId, input.clinicId),
          inArray(effectiveSchedules.doctorId, doctorIds),
        ),
      }),
      transaction.query.effectiveSchedulePeriods.findMany({
        where: and(
          eq(effectiveSchedulePeriods.clinicId, input.clinicId),
          inArray(effectiveSchedulePeriods.doctorId, doctorIds),
        ),
      }),
      transaction.query.availabilityBlocks.findMany({
        orderBy: [desc(availabilityBlocks.startsAt)],
        where: and(
          eq(availabilityBlocks.clinicId, input.clinicId),
          inArray(availabilityBlocks.doctorId, doctorIds),
        ),
      }),
    ]);
    return {
      blocks,
      doctors: managedDoctors.map((doctor) => ({
        id: doctor.id,
        publicName: doctor.publicName ?? "Médico sin nombre público",
      })),
      schedules: schedules.map((schedule) => ({
        ...schedule,
        periods: periods
          .filter((period) => period.scheduleId === schedule.id)
          .map(({ dayOfWeek, endTime, startTime }) => ({
            dayOfWeek,
            endTime,
            startTime,
          })),
      })),
    };
  });
}

async function insertBlock(
  transaction: ClinicTransaction,
  input: Parameters<AvailabilityBlockCreator["create"]>[0],
): Promise<AvailabilityBlock> {
  const [block] = await transaction
    .insert(availabilityBlocks)
    .values({
      clinicId: input.clinicId,
      doctorId: input.doctorId,
      endsAt: input.endsAt,
      privateLabel: input.privateLabel,
      startsAt: input.startsAt,
    })
    .returning({
      endsAt: availabilityBlocks.endsAt,
      id: availabilityBlocks.id,
      privateLabel: availabilityBlocks.privateLabel,
      startsAt: availabilityBlocks.startsAt,
    });
  if (block === undefined) throw new Error("No se pudo crear el Bloqueo");
  await transaction.insert(configurationAuditEvents).values({
    action: "availability-block-created",
    actorIdentityId: input.identityId,
    afterValues: blockAuditValues(block),
    clinicId: input.clinicId,
    entity: "availability-block",
    entityId: block.id,
  });
  return block;
}

async function scheduleConflicts(
  transaction: ClinicTransaction,
  input: Parameters<EffectiveScheduleReplacer["replace"]>[0] & {
    effectiveUntil: string | null;
  },
) {
  const occupancy = await activeOccupancy(transaction, input);
  return occupancy.filter(
    (event) =>
      localDate(new Date(event.startsAt)) >= input.effectiveFrom &&
      (input.effectiveUntil === null ||
        localDate(new Date(event.startsAt)) <= input.effectiveUntil) &&
      !isCoveredBySchedule(event, input.periods),
  );
}

async function intervalConflicts(
  transaction: ClinicTransaction,
  input: Pick<
    Parameters<AvailabilityBlockCreator["create"]>[0],
    "clinicId" | "doctorId" | "endsAt" | "startsAt"
  >,
) {
  const occupancy = await activeOccupancy(transaction, input);
  return occupancy.filter(
    (event) =>
      new Date(event.startsAt) < input.endsAt &&
      new Date(event.endsAt) > input.startsAt,
  );
}

async function activeOccupancy(
  transaction: ClinicTransaction,
  input: { clinicId: string; doctorId: string },
): Promise<CapacityConflict[]> {
  const [confirmed, reservations] = await Promise.all([
    transaction
      .select({
        endsAt: appointments.endsAt,
        id: appointments.id,
        startsAt: appointments.startsAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, input.clinicId),
          eq(appointments.doctorId, input.doctorId),
          eq(appointments.status, "confirmed"),
        ),
      ),
    transaction
      .select({
        endsAt: temporaryReservations.endsAt,
        id: temporaryReservations.id,
        startsAt: temporaryReservations.startsAt,
      })
      .from(temporaryReservations)
      .where(
        and(
          eq(temporaryReservations.clinicId, input.clinicId),
          eq(temporaryReservations.doctorId, input.doctorId),
          gt(temporaryReservations.expiresAt, new Date()),
        ),
      ),
  ]);
  return [
    ...confirmed.map((event) =>
      capacityConflict(event, input.doctorId, "confirmed-appointment"),
    ),
    ...reservations.map((event) =>
      capacityConflict(event, input.doctorId, "active-temporary-reservation"),
    ),
  ];
}

async function canManageDoctor(
  transaction: ClinicTransaction,
  input: { clinicId: string; doctorId: string; identityId: string },
) {
  const member = await transaction.query.clinicUsers.findFirst({
    columns: { id: true, role: true },
    where: and(
      eq(clinicUsers.clinicId, input.clinicId),
      eq(clinicUsers.identityId, input.identityId),
      eq(clinicUsers.active, true),
    ),
  });
  if (member === undefined || member.role === "secretary") return false;
  if (member.role === "owner") return true;
  const doctor = await transaction.query.doctors.findFirst({
    columns: { id: true },
    where: and(
      eq(doctors.clinicId, input.clinicId),
      eq(doctors.clinicUserId, member.id),
      eq(doctors.id, input.doctorId),
    ),
  });
  return doctor !== undefined;
}

async function isOwner(
  transaction: ClinicTransaction,
  input: { clinicId: string; identityId: string },
) {
  const owner = await transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, input.clinicId),
      eq(clinicUsers.identityId, input.identityId),
      eq(clinicUsers.active, true),
      eq(clinicUsers.role, "owner"),
    ),
  });
  return owner !== undefined;
}

async function lockDoctor(transaction: ClinicTransaction, doctorId: string) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${doctorId}))`,
  );
}

function isCoveredBySchedule(
  event: Pick<CapacityConflict, "endsAt" | "startsAt">,
  periods: WeeklyPeriod[],
) {
  const startsAt = localDateTime(new Date(event.startsAt));
  const endsAt = localDateTime(new Date(event.endsAt));
  if (startsAt.date !== endsAt.date) return false;
  return periods.some(
    (period) =>
      period.dayOfWeek === startsAt.dayOfWeek &&
      period.startTime <= startsAt.time &&
      period.endTime >= endsAt.time,
  );
}

function capacityConflict(
  event: { endsAt: Date; id: string; startsAt: Date },
  doctorId: string,
  kind: CapacityConflict["kind"],
): CapacityConflict {
  return {
    doctorId,
    endsAt: event.endsAt.toISOString(),
    id: event.id,
    kind,
    startsAt: event.startsAt.toISOString(),
  };
}

function localDate(value: Date) {
  return localDateTime(value).date;
}

function localDateTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    year: "numeric",
  }).formatToParts(value);
  const part = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find(({ type }) => type === kind)?.value;
  const weekday = part("weekday");
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday ?? "",
  );
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    dayOfWeek,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function previousLocalDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function scheduleAuditValues(schedule: EffectiveSchedule) {
  return {
    effectiveFrom: schedule.effectiveFrom,
    effectiveUntil: schedule.effectiveUntil,
    periods: JSON.stringify(schedule.periods),
  };
}

function blockAuditValues(block: AvailabilityBlock) {
  return {
    endsAt: block.endsAt.toISOString(),
    privateLabel: block.privateLabel,
    startsAt: block.startsAt.toISOString(),
  };
}
