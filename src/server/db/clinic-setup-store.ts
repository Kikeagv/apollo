import { and, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import {
  type ClinicTermsAcceptance,
  type ClinicSetupEvaluationInput,
  type ClinicSetupFirstValidRoute,
  type ClinicSetupStepId,
  isCurrentClinicTermsAcceptance,
  requireCurrentClinicTermsAcceptance,
} from "~/domain/clinic-setup";
import { doctorProfileProgress } from "~/domain/panacea-team";
import { calculateCareOptionsFromInputs } from "~/server/application/care-options";
import type {
  ClinicReadinessDeclarer,
  ClinicSetupBasicsUpdater,
  ClinicSetupProgressWriter,
  ClinicSetupReader,
} from "~/server/application/clinic-setup";
import { readAgendaCapacity } from "~/server/db/agenda-capacity-store";
import { inClinicTransaction } from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  clinicInvitations,
  clinicReadiness,
  clinics,
  clinicUsers,
  configurationAuditEvents,
  doctors,
  effectiveSchedules,
  serviceOffers,
  services,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type EvaluatedClinicSetup = ClinicSetupEvaluationInput & {
  validOfferIds: Set<string>;
};

const CLINIC_SETUP_STEP_NUMBERS: Record<ClinicSetupStepId, number> = {
  availability: 4,
  clinic: 1,
  review: 5,
  services: 3,
  team: 2,
};

const READINESS_WINDOW_DAYS = 30;

export const drizzleClinicSetupStore: ClinicSetupReader &
  ClinicSetupProgressWriter &
  ClinicSetupBasicsUpdater &
  ClinicReadinessDeclarer = {
  async read(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await isOwner(transaction, input))) return undefined;
      return recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
        initializeIfMissing: true,
      });
    });
  },

  async saveStep(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await isOwner(transaction, input))) return undefined;
      await ensureReadinessRow(transaction, input.clinicId);
      const current = await transaction.query.clinicReadiness.findFirst({
        columns: { currentStep: true },
        where: eq(clinicReadiness.clinicId, input.clinicId),
      });
      const currentStep = CLINIC_SETUP_STEP_NUMBERS[input.step];
      await transaction
        .update(clinicReadiness)
        .set({ currentStep, updatedAt: new Date() })
        .where(eq(clinicReadiness.clinicId, input.clinicId));
      if (current?.currentStep !== currentStep) {
        await recordReadinessAudit(transaction, {
          action: "clinic-setup-step-saved",
          actorIdentityId: input.identityId,
          afterValues: { currentStep: String(currentStep) },
          beforeValues:
            current === undefined
              ? undefined
              : { currentStep: String(current.currentStep) },
          clinicId: input.clinicId,
        });
      }
      return true;
    });
  },

  async updateBasics(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await isOwner(transaction, input))) return undefined;
      const clinic = await transaction.query.clinics.findFirst({
        columns: { name: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) return undefined;
      if (clinic.name !== input.name) {
        await transaction
          .update(clinics)
          .set({ name: input.name })
          .where(eq(clinics.id, input.clinicId));
        await recordReadinessAudit(transaction, {
          action: "clinic-basic-data-updated",
          actorIdentityId: input.identityId,
          afterValues: { name: input.name },
          beforeValues: { name: clinic.name },
          clinicId: input.clinicId,
          entity: "clinic",
        });
      }
      return recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
        initializeIfMissing: true,
      });
    });
  },

  async declare(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await isOwner(transaction, input))) return undefined;
      const termsAcceptance = requireCurrentClinicTermsAcceptance(
        input.termsAcceptance,
      );
      const evaluation = await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
        initializeIfMissing: true,
      });
      if (evaluation === undefined) return undefined;
      if (evaluation.firstValidRoute === null) return evaluation;

      const readiness = await ensureReadinessRow(transaction, input.clinicId);
      let termsAcceptedAt = readiness.termsAcceptedAt;
      if (
        !isCurrentClinicTermsAcceptance(termsAcceptanceFromReadiness(readiness))
      ) {
        const now = new Date();
        termsAcceptedAt = now;
        await transaction
          .update(clinicReadiness)
          .set({
            termsAcceptedAt: now,
            termsAcceptedByIdentityId: input.identityId,
            termsAcceptedVersion: termsAcceptance.version,
            updatedAt: now,
          })
          .where(eq(clinicReadiness.clinicId, input.clinicId));
        await recordReadinessAudit(transaction, {
          action: "clinic-terms-accepted",
          actorIdentityId: input.identityId,
          afterValues: {
            termsAccepted: "true",
            termsVersion: termsAcceptance.version,
          },
          beforeValues: {
            termsAccepted: "false",
            termsVersion: readiness.termsAcceptedVersion,
          },
          clinicId: input.clinicId,
          entity: "clinic-terms",
        });
      }
      if (!readiness.asclepioEnabled) {
        const now = new Date();
        await transaction
          .update(clinicReadiness)
          .set({
            asclepioEnabled: true,
            asclepioEnabledAt: now,
            readinessStatus: "ready",
            updatedAt: now,
          })
          .where(eq(clinicReadiness.clinicId, input.clinicId));
        await recordReadinessAudit(transaction, {
          action: "asclepio-enabled",
          actorIdentityId: input.identityId,
          afterValues: {
            asclepioEnabled: "true",
            readinessStatus: "ready",
          },
          beforeValues: {
            asclepioEnabled: String(readiness.asclepioEnabled),
            readinessStatus: readiness.readinessStatus,
          },
          clinicId: input.clinicId,
        });
      }
      return {
        ...evaluation,
        clinic: { ...evaluation.clinic, asclepioEnabled: true },
        termsAcceptance: {
          acceptedAt: termsAcceptedAt,
          version: termsAcceptance.version,
        },
      };
    });
  },
};

/** Recalcula la ruta mínima dentro de la misma transacción que cambió capacidad. */
export async function recalculateClinicReadiness(
  transaction: ClinicTransaction,
  input: {
    actorIdentityId?: string;
    clinicId: string;
    initializeIfMissing?: boolean;
    now?: Date;
  },
) {
  await transaction.execute(
    // La serialización evita que dos cambios de capacidad sobrescriban el estado.
    // El bloqueo vive solo durante la transacción clínica actual.
    sql`select pg_advisory_xact_lock(hashtext(${`clinic-readiness:${input.clinicId}`}))`,
  );
  await transaction.execute(
    sql`select set_config('app.readiness_recalculation', 'true', true)`,
  );
  const existing = await readReadinessRow(transaction, input.clinicId);
  if (existing === undefined && input.initializeIfMissing !== true) {
    return undefined;
  }
  const current =
    existing ?? (await ensureReadinessRow(transaction, input.clinicId));
  const evaluated = await evaluateClinicSetup(
    transaction,
    input.clinicId,
    readinessForEvaluation(current),
    input.now ?? new Date(),
  );
  const evaluation = withoutInternalEvaluation(evaluated);
  const nextStatus =
    evaluation.firstValidRoute === null ? ("pending" as const) : "ready";
  // La aceptación se valida al declarar; no revocamos habilitaciones históricas
  // solo porque APO-72 aún no tenga un registro de aceptación.
  const nextEnabled = current.asclepioEnabled && nextStatus === "ready";
  const statusChanged =
    current.readinessStatus !== nextStatus ||
    current.asclepioEnabled !== nextEnabled;

  if (statusChanged) {
    await transaction
      .update(clinicReadiness)
      .set({
        asclepioEnabled: nextEnabled,
        asclepioEnabledAt: nextEnabled ? current.asclepioEnabledAt : null,
        readinessStatus: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(clinicReadiness.clinicId, input.clinicId));
    if (input.actorIdentityId !== undefined) {
      await recordReadinessAudit(transaction, {
        action: "clinic-readiness-recalculated",
        actorIdentityId: input.actorIdentityId,
        afterValues: {
          asclepioEnabled: String(nextEnabled),
          readinessStatus: nextStatus,
        },
        beforeValues: {
          asclepioEnabled: String(current.asclepioEnabled),
          readinessStatus: current.readinessStatus,
        },
        clinicId: input.clinicId,
      });
    }
  }

  return {
    ...evaluation,
    clinic: {
      ...evaluation.clinic,
      asclepioEnabled: nextEnabled,
    },
  } satisfies ClinicSetupEvaluationInput;
}

/** Consulta usada por el adaptador de Asclepio antes de ofrecer nuevas Opciones. */
export async function isAsclepioEnabled(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  const readiness = await readReadinessRow(transaction, clinicId);
  // Clínicas creadas antes de APO-65 no tienen fila hasta que abren la guía;
  // conservamos su operación existente durante la migración progresiva.
  if (readiness === undefined) return true;
  return (
    readiness.asclepioEnabled === true && readiness.readinessStatus === "ready"
  );
}

/** Devuelve las Ofertas que tienen capacidad futura propia para Asclepio. */
export async function listAsclepioOfferIds(
  transaction: ClinicTransaction,
  clinicId: string,
  now = new Date(),
) {
  const readiness = await readReadinessRow(transaction, clinicId);
  if (readiness === undefined) return undefined;
  const evaluation = await evaluateClinicSetup(
    transaction,
    clinicId,
    readinessForEvaluation(readiness),
    now,
  );
  return evaluation.validOfferIds;
}

async function evaluateClinicSetup(
  transaction: ClinicTransaction,
  clinicId: string,
  readiness: {
    asclepioEnabled: boolean;
    currentStep: number;
    termsAcceptance: ClinicTermsAcceptance;
  },
  now: Date,
): Promise<EvaluatedClinicSetup> {
  const today = localDate(now);
  const from = today;
  const to = addLocalDays(today, READINESS_WINDOW_DAYS);
  const startsAt = localMidnight(from);
  const endsAt = localMidnight(addLocalDays(to, 1));

  const [clinic, activeDoctors, pendingInvitations, offers, schedules] =
    await Promise.all([
      transaction.query.clinics.findFirst({
        columns: { name: true },
        where: eq(clinics.id, clinicId),
      }),
      transaction
        .select({
          id: doctors.id,
          primarySpecialty: doctors.primarySpecialty,
          publicName: doctors.publicName,
        })
        .from(doctors)
        .innerJoin(
          clinicUsers,
          and(
            eq(doctors.clinicId, clinicUsers.clinicId),
            eq(doctors.clinicUserId, clinicUsers.id),
          ),
        )
        .where(
          and(
            eq(doctors.clinicId, clinicId),
            eq(doctors.active, true),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          ),
        ),
      transaction.query.clinicInvitations.findMany({
        columns: { id: true },
        where: and(
          eq(clinicInvitations.clinicId, clinicId),
          eq(clinicInvitations.role, "doctor"),
          isNull(clinicInvitations.consumedAt),
          gt(clinicInvitations.expiresAt, now),
        ),
      }),
      transaction
        .select({
          bufferMinutes: serviceOffers.bufferMinutes,
          doctorId: doctors.id,
          doctorName: doctors.publicName,
          durationMinutes: serviceOffers.durationMinutes,
          id: serviceOffers.id,
          serviceId: services.id,
          serviceName: services.name,
          specialty: doctors.primarySpecialty,
        })
        .from(serviceOffers)
        .innerJoin(
          services,
          and(
            eq(serviceOffers.clinicId, services.clinicId),
            eq(serviceOffers.serviceId, services.id),
          ),
        )
        .innerJoin(
          doctors,
          and(
            eq(serviceOffers.clinicId, doctors.clinicId),
            eq(serviceOffers.doctorId, doctors.id),
          ),
        )
        .innerJoin(
          clinicUsers,
          and(
            eq(doctors.clinicId, clinicUsers.clinicId),
            eq(doctors.clinicUserId, clinicUsers.id),
          ),
        )
        .where(
          and(
            eq(serviceOffers.clinicId, clinicId),
            eq(serviceOffers.active, true),
            eq(doctors.active, true),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          ),
        ),
      transaction.query.effectiveSchedules.findMany({
        columns: { doctorId: true, id: true },
        where: and(
          eq(effectiveSchedules.clinicId, clinicId),
          lte(effectiveSchedules.effectiveFrom, to),
          or(
            isNull(effectiveSchedules.effectiveUntil),
            gte(effectiveSchedules.effectiveUntil, from),
          ),
        ),
      }),
    ]);

  if (clinic === undefined) throw new Error("La Clínica no existe");
  const completedDoctorIds = new Set(
    activeDoctors
      .filter((doctor) => doctorProfileProgress(doctor).status === "complete")
      .map((doctor) => doctor.id),
  );
  const eligibleOffers = offers
    .filter(
      (offer) =>
        completedDoctorIds.has(offer.doctorId) &&
        offer.doctorName !== null &&
        offer.doctorName.trim().length > 0 &&
        offer.specialty !== null &&
        offer.specialty.trim().length > 0,
    )
    .sort((left, right) =>
      `${left.doctorName}:${left.serviceName}`.localeCompare(
        `${right.doctorName}:${right.serviceName}`,
      ),
    );
  const activeServiceIds = new Set(offers.map((offer) => offer.serviceId));
  const capacities = new Map<
    string,
    Awaited<ReturnType<typeof readAgendaCapacity>>
  >();
  const validOfferIds = new Set<string>();
  let futureCareOptions = 0;
  let firstValidRoute: ClinicSetupFirstValidRoute | undefined;

  for (const offer of eligibleOffers) {
    let capacity = capacities.get(offer.doctorId);
    if (capacity === undefined) {
      capacity = await readAgendaCapacity(
        transaction,
        {
          clinicId,
          doctorId: offer.doctorId,
          endsAt,
          startsAt,
        },
        now,
      );
      capacities.set(offer.doctorId, capacity);
    }
    const options = calculateCareOptionsFromInputs(
      { from, to },
      { ...capacity, offer },
      now,
    );
    futureCareOptions += options.length;
    if (options.length > 0) validOfferIds.add(offer.id);
    if (firstValidRoute === undefined && options[0] !== undefined) {
      const firstOption = options[0];
      const optionDate = localDate(firstOption.startsAt);
      const matchingSchedule = capacity.schedules
        .filter(
          (schedule) =>
            schedule.effectiveFrom <= optionDate &&
            (schedule.effectiveUntil === null ||
              schedule.effectiveUntil >= optionDate),
        )
        .sort((left, right) =>
          right.effectiveFrom.localeCompare(left.effectiveFrom),
        )[0];
      if (matchingSchedule !== undefined) {
        firstValidRoute = {
          doctor: {
            id: offer.doctorId,
            name: offer.doctorName ?? "",
            specialty: offer.specialty ?? "",
          },
          firstOptionStartsAt: firstOption.startsAt,
          scheduleEffectiveFrom: matchingSchedule.effectiveFrom,
          service: {
            durationMinutes: offer.durationMinutes,
            id: offer.serviceId,
            name: offer.serviceName,
          },
        };
      }
    }
  }

  return {
    availability: {
      activeSchedules: schedules.filter((schedule) =>
        activeDoctors.some((doctor) => doctor.id === schedule.doctorId),
      ).length,
      futureCareOptions,
    },
    clinic: {
      asclepioEnabled: readiness.asclepioEnabled,
      currentStep: readiness.currentStep,
      name: clinic.name,
    },
    firstValidRoute: firstValidRoute ?? null,
    services: {
      activeOffers: offers.length,
      activeServices: activeServiceIds.size,
    },
    team: {
      activeDoctors: activeDoctors.length,
      completedProfiles: completedDoctorIds.size,
      pendingInvitations: pendingInvitations.length,
    },
    termsAcceptance: readiness.termsAcceptance,
    validOfferIds,
  };
}

function readinessForEvaluation(readiness: {
  asclepioEnabled: boolean;
  currentStep: number;
  termsAcceptedAt: Date | null;
  termsAcceptedVersion: string | null;
}) {
  return {
    asclepioEnabled: readiness.asclepioEnabled,
    currentStep: readiness.currentStep,
    termsAcceptance: termsAcceptanceFromReadiness(readiness),
  };
}

function termsAcceptanceFromReadiness(readiness: {
  termsAcceptedAt: Date | null;
  termsAcceptedVersion: string | null;
}): ClinicTermsAcceptance {
  return {
    acceptedAt: readiness.termsAcceptedAt,
    version: readiness.termsAcceptedVersion,
  };
}

function withoutInternalEvaluation(
  evaluation: EvaluatedClinicSetup,
): ClinicSetupEvaluationInput {
  return {
    availability: evaluation.availability,
    clinic: evaluation.clinic,
    firstValidRoute: evaluation.firstValidRoute,
    services: evaluation.services,
    termsAcceptance: evaluation.termsAcceptance,
    team: evaluation.team,
  };
}

async function ensureReadinessRow(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction
    .insert(clinicReadiness)
    .values({ clinicId })
    .onConflictDoNothing({ target: clinicReadiness.clinicId });
  const readiness = await readReadinessRow(transaction, clinicId);
  if (readiness === undefined) {
    throw new Error(
      "No se pudo inicializar el estado de Configuración inicial",
    );
  }
  return readiness;
}

async function readReadinessRow(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  return transaction.query.clinicReadiness.findFirst({
    columns: {
      asclepioEnabled: true,
      asclepioEnabledAt: true,
      currentStep: true,
      readinessStatus: true,
      termsAcceptedAt: true,
      termsAcceptedVersion: true,
    },
    where: eq(clinicReadiness.clinicId, clinicId),
  });
}

async function isOwner(
  transaction: ClinicTransaction,
  input: { clinicId: string; identityId: string },
) {
  return (
    (await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.role, "owner"),
        eq(clinicUsers.active, true),
      ),
    })) !== undefined
  );
}

async function recordReadinessAudit(
  transaction: ClinicTransaction,
  input: {
    action: string;
    actorIdentityId: string;
    afterValues: Record<string, string | null>;
    beforeValues?: Record<string, string | null>;
    clinicId: string;
    entity?: string;
  },
) {
  await transaction.insert(configurationAuditEvents).values({
    action: input.action,
    actorIdentityId: input.actorIdentityId,
    afterValues: input.afterValues,
    beforeValues: input.beforeValues,
    clinicId: input.clinicId,
    entity: input.entity ?? "clinic-readiness",
    entityId: input.clinicId,
  });
}

function localDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localMidnight(date: string) {
  return new Date(`${date}T00:00:00${CLINIC_UTC_OFFSET}`);
}

function addLocalDays(date: string, amount: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}
