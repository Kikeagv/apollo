import { and, eq, gte, gt, inArray, isNull, or } from "drizzle-orm";

import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import { type PanaceaConfigurationOverviewInput } from "~/domain/panacea-configuration";
import { doctorProfileProgress } from "~/domain/panacea-team";
import { calculateCareOptionsFromInputs } from "~/server/application/care-options";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { readAgendaCapacity } from "~/server/db/agenda-capacity-store";
import type { db } from "~/server/db";
import {
  clinics,
  clinicInvitations,
  clinicUsers,
  doctors,
  effectiveSchedules,
  serviceOffers,
  services,
} from "~/server/db/schema";
import type { PanaceaConfigurationReader } from "~/server/application/panacea-configuration";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const drizzlePanaceaConfigurationReader: PanaceaConfigurationReader = {
  async read(input) {
    return inClinicTransaction(input, async (transaction) => {
      const membership = await transaction.query.clinicUsers.findFirst({
        columns: { id: true, role: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.active, true),
        ),
      });
      if (membership === undefined || membership.role === "secretary") {
        return undefined;
      }

      const visibleDoctors = await readVisibleDoctors(
        transaction,
        input.clinicId,
        membership,
      );
      const eligibleDoctors = visibleDoctors.filter(
        (doctor) => doctorProfileProgress(doctor).status === "complete",
      );
      const doctorIds = eligibleDoctors.map((doctor) => doctor.id);
      const eligibleDoctorIds = new Set(doctorIds);
      const today = localDate(new Date());

      const [invitationRows, serviceRows, offerRows, scheduleRows, clinic] =
        await Promise.all([
          membership.role === "owner"
            ? transaction.query.clinicInvitations.findMany({
                columns: { consumedAt: true, expiresAt: true },
                where: and(
                  eq(clinicInvitations.clinicId, input.clinicId),
                  eq(clinicInvitations.role, "doctor"),
                  isNull(clinicInvitations.consumedAt),
                  gt(clinicInvitations.expiresAt, new Date()),
                ),
              })
            : [],
          transaction.query.services.findMany({
            columns: { id: true },
            where: eq(services.clinicId, input.clinicId),
          }),
          transaction.query.serviceOffers.findMany({
            columns: {
              bufferMinutes: true,
              doctorId: true,
              durationMinutes: true,
              serviceId: true,
            },
            where: and(
              eq(serviceOffers.clinicId, input.clinicId),
              eq(serviceOffers.active, true),
            ),
          }),
          doctorIds.length === 0
            ? []
            : transaction.query.effectiveSchedules.findMany({
                columns: {
                  doctorId: true,
                  effectiveFrom: true,
                  effectiveUntil: true,
                },
                where: and(
                  eq(effectiveSchedules.clinicId, input.clinicId),
                  inArray(effectiveSchedules.doctorId, doctorIds),
                  or(
                    isNull(effectiveSchedules.effectiveUntil),
                    gte(effectiveSchedules.effectiveUntil, today),
                  ),
                ),
              }),
          transaction.query.clinics.findFirst({
            columns: {
              escalationNotificationsEnabled: true,
              noShowPolicy: true,
              whatsappNumberE164: true,
              voiceTranscriptionEnabled: true,
            },
            where: eq(clinics.id, input.clinicId),
          }),
        ]);

      const serviceIds = new Set(serviceRows.map((service) => service.id));
      const activeOffers = offerRows.filter(
        (offer) =>
          serviceIds.has(offer.serviceId) &&
          eligibleDoctorIds.has(offer.doctorId),
      );
      const futureCareOptions = await countFutureCareOptions(
        transaction,
        input.clinicId,
        activeOffers,
      );

      return {
        availability: {
          activeSchedules: scheduleRows.length,
          futureCareOptions,
        },
        services: {
          activeOffers: activeOffers.length,
          activeServices: new Set(activeOffers.map((offer) => offer.serviceId))
            .size,
        },
        team: {
          activeDoctors: visibleDoctors.length,
          completedProfiles: visibleDoctors.filter(
            (doctor) => doctorProfileProgress(doctor).status === "complete",
          ).length,
          pendingInvitations: invitationRows.length,
        },
        whatsapp: {
          configured:
            (clinic?.whatsappNumberE164 !== null &&
              clinic?.whatsappNumberE164 !== undefined) ||
            clinic?.noShowPolicy === "cancel-after-third-reminder" ||
            clinic?.escalationNotificationsEnabled === true ||
            clinic?.voiceTranscriptionEnabled === true,
        },
      } satisfies PanaceaConfigurationOverviewInput;
    });
  },
};

async function readVisibleDoctors(
  transaction: ClinicTransaction,
  clinicId: string,
  membership: { id: string; role: "doctor" | "owner" | "secretary" },
) {
  const scope =
    membership.role === "owner"
      ? eq(doctors.clinicId, clinicId)
      : and(
          eq(doctors.clinicId, clinicId),
          eq(doctors.clinicUserId, membership.id),
        );

  return transaction
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
        scope,
        eq(doctors.active, true),
        eq(clinicUsers.clinicId, clinicId),
        eq(clinicUsers.active, true),
        inArray(clinicUsers.role, ["owner", "doctor"]),
      ),
    );
}

async function countFutureCareOptions(
  transaction: ClinicTransaction,
  clinicId: string,
  offers: Array<{
    bufferMinutes: number;
    doctorId: string;
    durationMinutes: number;
    serviceId: string;
  }>,
) {
  if (offers.length === 0) return 0;

  const from = nextLocalDate(localDate(new Date()));
  const to = addLocalDays(from, 30);
  const startsAt = localMidnight(from);
  const endsAt = localMidnight(addLocalDays(to, 1));
  const capacities = new Map<
    string,
    Awaited<ReturnType<typeof readAgendaCapacity>>
  >();
  let total = 0;

  for (const offer of offers) {
    let capacity = capacities.get(offer.doctorId);
    if (capacity === undefined) {
      capacity = await readAgendaCapacity(transaction, {
        clinicId,
        doctorId: offer.doctorId,
        endsAt,
        startsAt,
      });
      capacities.set(offer.doctorId, capacity);
    }
    total += calculateCareOptionsFromInputs(
      { from, to },
      { ...capacity, offer },
    ).length;
  }

  return total;
}

function localMidnight(date: string) {
  return new Date(`${date}T00:00:00${CLINIC_UTC_OFFSET}`);
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

function nextLocalDate(date: string) {
  return addLocalDays(date, 1);
}

function addLocalDays(date: string, amount: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}
