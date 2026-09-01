import { and, eq, inArray, sql } from "drizzle-orm";

import { CapacityConflictError } from "~/server/application/availability";
import {
  type ServiceCatalogUpdater,
  type ServiceCatalogStore,
  type ServiceOfferCreator,
  type ServiceOffer,
  type ServiceOfferDeactivator,
  type ServiceOfferUpdater,
} from "~/server/application/service-catalog";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { capacityConflictsForDoctor } from "~/server/db/doctor-occupancy-store";
import { recalculateClinicReadiness } from "~/server/db/clinic-setup-store";
import {
  clinicUsers,
  configurationAuditEvents,
  doctors,
  serviceOffers,
  services,
} from "~/server/db/schema";

export class IneligibleServiceOfferDoctorError extends Error {
  constructor() {
    super("Cada Oferta debe corresponder a un Médico elegible de la Clínica");
    this.name = "IneligibleServiceOfferDoctorError";
  }
}

export class ServiceNameConflictError extends Error {
  constructor() {
    super("Ya existe un Servicio con ese nombre en la Clínica");
    this.name = "ServiceNameConflictError";
  }
}

export class LastActiveServiceOfferError extends Error {
  constructor() {
    super("El Servicio debe conservar al menos una Oferta activa");
    this.name = "LastActiveServiceOfferError";
  }
}

export const drizzleServiceCatalogStore: ServiceCatalogStore &
  ServiceCatalogUpdater &
  ServiceOfferCreator &
  ServiceOfferDeactivator &
  ServiceOfferUpdater = {
  async create(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await ownerCanConfigure(transaction, input))) return undefined;

      const existing = await transaction.query.services.findFirst({
        columns: { id: true },
        where: and(
          eq(services.clinicId, input.clinicId),
          eq(services.normalizedName, input.normalizedName),
        ),
      });
      if (existing !== undefined) throw new ServiceNameConflictError();

      await requireEligibleDoctors(
        transaction,
        input.clinicId,
        input.offers.map((offer) => offer.doctorId),
      );

      const [service] = await transaction
        .insert(services)
        .values({
          clinicId: input.clinicId,
          description: input.description,
          name: input.name,
          normalizedName: input.normalizedName,
        })
        .returning({
          description: services.description,
          id: services.id,
          name: services.name,
        });
      if (service === undefined)
        throw new Error("No se pudo crear el Servicio");

      const createdOffers = await transaction
        .insert(serviceOffers)
        .values(
          input.offers.map((offer) => ({
            ...offer,
            clinicId: input.clinicId,
            serviceId: service.id,
          })),
        )
        .returning({
          active: serviceOffers.active,
          bufferMinutes: serviceOffers.bufferMinutes,
          doctorId: serviceOffers.doctorId,
          durationMinutes: serviceOffers.durationMinutes,
          id: serviceOffers.id,
          priceUsd: serviceOffers.priceUsd,
        });

      await transaction.insert(configurationAuditEvents).values([
        {
          action: "service-created",
          actorIdentityId: input.identityId,
          afterValues: {
            description: service.description,
            name: service.name,
            normalizedName: input.normalizedName,
          },
          clinicId: input.clinicId,
          entity: "service",
          entityId: service.id,
        },
        ...createdOffers.map((offer) => ({
          action: "service-offer-created",
          actorIdentityId: input.identityId,
          afterValues: offerAuditValues(offer),
          clinicId: input.clinicId,
          entity: "service-offer",
          entityId: offer.id,
        })),
      ]);
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
      });

      return { ...service, offers: createdOffers };
    });
  },

  async updateService(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await ownerCanConfigure(transaction, input))) return undefined;

      const existing = await transaction.query.services.findFirst({
        columns: {
          description: true,
          id: true,
          name: true,
          normalizedName: true,
        },
        where: and(
          eq(services.id, input.serviceId),
          eq(services.clinicId, input.clinicId),
        ),
      });
      if (existing === undefined) return undefined;

      if (existing.normalizedName !== input.normalizedName) {
        const conflictingService = await transaction.query.services.findFirst({
          columns: { id: true },
          where: and(
            eq(services.clinicId, input.clinicId),
            eq(services.normalizedName, input.normalizedName),
          ),
        });
        if (conflictingService !== undefined) {
          throw new ServiceNameConflictError();
        }
      }

      const [updated] = await transaction
        .update(services)
        .set({
          description: input.description,
          name: input.name,
          normalizedName: input.normalizedName,
        })
        .where(
          and(
            eq(services.id, existing.id),
            eq(services.clinicId, input.clinicId),
          ),
        )
        .returning({
          description: services.description,
          id: services.id,
          name: services.name,
        });
      if (updated === undefined) return undefined;

      const offers = await transaction.query.serviceOffers.findMany({
        columns: {
          active: true,
          bufferMinutes: true,
          doctorId: true,
          durationMinutes: true,
          id: true,
          priceUsd: true,
          serviceId: true,
        },
        where: and(
          eq(serviceOffers.clinicId, input.clinicId),
          eq(serviceOffers.serviceId, input.serviceId),
        ),
      });
      await transaction.insert(configurationAuditEvents).values({
        action: "service-updated",
        actorIdentityId: input.identityId,
        afterValues: {
          description: updated.description,
          name: updated.name,
          normalizedName: input.normalizedName,
        },
        beforeValues: {
          description: existing.description,
          name: existing.name,
          normalizedName: existing.normalizedName,
        },
        clinicId: input.clinicId,
        entity: "service",
        entityId: updated.id,
      });

      return {
        ...updated,
        offers: offers.map(({ serviceId: _, ...offer }) => offer),
      };
    });
  },

  async add(input) {
    return inClinicTransaction(input, async (transaction) => {
      const service = await transaction.query.services.findFirst({
        columns: { id: true },
        where: and(
          eq(services.id, input.serviceId),
          eq(services.clinicId, input.clinicId),
        ),
      });
      if (service === undefined) return undefined;
      if (
        !(await canManageOffer(transaction, {
          clinicId: input.clinicId,
          doctorId: input.doctorId,
          identityId: input.identityId,
        }))
      ) {
        return undefined;
      }
      await requireEligibleDoctors(transaction, input.clinicId, [
        input.doctorId,
      ]);

      const [offer] = await transaction
        .insert(serviceOffers)
        .values({
          ...input,
          serviceId: service.id,
        })
        .returning({
          active: serviceOffers.active,
          bufferMinutes: serviceOffers.bufferMinutes,
          doctorId: serviceOffers.doctorId,
          durationMinutes: serviceOffers.durationMinutes,
          id: serviceOffers.id,
          priceUsd: serviceOffers.priceUsd,
        });
      if (offer === undefined) throw new Error("No se pudo crear la Oferta");

      await transaction.insert(configurationAuditEvents).values({
        action: "service-offer-created",
        actorIdentityId: input.identityId,
        afterValues: offerAuditValues(offer),
        clinicId: input.clinicId,
        entity: "service-offer",
        entityId: offer.id,
      });
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
      });
      return offer;
    });
  },

  async update(input) {
    return inClinicTransaction(input, async (transaction) => {
      const offer = await transaction.query.serviceOffers.findFirst({
        columns: {
          active: true,
          bufferMinutes: true,
          doctorId: true,
          durationMinutes: true,
          id: true,
          priceUsd: true,
        },
        where: and(
          eq(serviceOffers.id, input.offerId),
          eq(serviceOffers.clinicId, input.clinicId),
          eq(serviceOffers.active, true),
        ),
      });
      if (offer === undefined) return undefined;
      if (
        !(await canManageOffer(transaction, {
          clinicId: input.clinicId,
          doctorId: offer.doctorId,
          identityId: input.identityId,
        }))
      ) {
        return undefined;
      }

      const [updated] = await transaction
        .update(serviceOffers)
        .set({
          bufferMinutes: input.bufferMinutes,
          durationMinutes: input.durationMinutes,
          priceUsd: input.priceUsd,
        })
        .where(eq(serviceOffers.id, offer.id))
        .returning({
          active: serviceOffers.active,
          bufferMinutes: serviceOffers.bufferMinutes,
          doctorId: serviceOffers.doctorId,
          durationMinutes: serviceOffers.durationMinutes,
          id: serviceOffers.id,
          priceUsd: serviceOffers.priceUsd,
        });
      if (updated === undefined) return undefined;

      await transaction.insert(configurationAuditEvents).values({
        action: "service-offer-updated",
        actorIdentityId: input.identityId,
        afterValues: offerAuditValues(updated),
        beforeValues: offerAuditValues(offer),
        clinicId: input.clinicId,
        entity: "service-offer",
        entityId: updated.id,
      });
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
      });
      return updated;
    });
  },

  async deactivate(input) {
    return inClinicTransaction(input, async (transaction) => {
      const offer = await transaction.query.serviceOffers.findFirst({
        columns: {
          active: true,
          bufferMinutes: true,
          doctorId: true,
          durationMinutes: true,
          id: true,
          priceUsd: true,
          serviceId: true,
        },
        where: and(
          eq(serviceOffers.id, input.offerId),
          eq(serviceOffers.clinicId, input.clinicId),
          eq(serviceOffers.active, true),
        ),
      });
      if (offer === undefined) return undefined;
      if (
        !(await canManageOffer(transaction, {
          clinicId: input.clinicId,
          doctorId: offer.doctorId,
          identityId: input.identityId,
        }))
      ) {
        return undefined;
      }

      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${offer.serviceId}))`,
      );
      await transaction.execute(
        sql`select set_config('app.service_offer_active_count', 'true', true)`,
      );
      const activeOffers = await transaction.query.serviceOffers.findMany({
        columns: { id: true },
        where: and(
          eq(serviceOffers.serviceId, offer.serviceId),
          eq(serviceOffers.active, true),
        ),
      });
      await transaction.execute(
        sql`select set_config('app.service_offer_active_count', 'false', true)`,
      );
      if (activeOffers.length <= 1) throw new LastActiveServiceOfferError();

      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${offer.doctorId}))`,
      );
      const conflicts = await capacityConflictsForDoctor(transaction, {
        clinicId: input.clinicId,
        doctorId: offer.doctorId,
        serviceOfferId: offer.id,
      });
      if (conflicts.length > 0) throw new CapacityConflictError(conflicts);

      const [deactivated] = await transaction
        .update(serviceOffers)
        .set({ active: false, deactivatedAt: new Date() })
        .where(eq(serviceOffers.id, offer.id))
        .returning({
          active: serviceOffers.active,
          bufferMinutes: serviceOffers.bufferMinutes,
          doctorId: serviceOffers.doctorId,
          durationMinutes: serviceOffers.durationMinutes,
          id: serviceOffers.id,
          priceUsd: serviceOffers.priceUsd,
        });
      if (deactivated === undefined) return undefined;

      await transaction.insert(configurationAuditEvents).values({
        action: "service-offer-deactivated",
        actorIdentityId: input.identityId,
        afterValues: offerAuditValues(deactivated),
        beforeValues: offerAuditValues(offer),
        clinicId: input.clinicId,
        entity: "service-offer",
        entityId: deactivated.id,
      });
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
      });
      return deactivated as ServiceOffer & { active: false };
    });
  },
};

export async function listServiceCatalog(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    const membership = await transaction.query.clinicUsers.findFirst({
      columns: { id: true, role: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.active, true),
        inArray(clinicUsers.role, ["owner", "doctor"]),
      ),
    });
    if (membership === undefined) return undefined;

    const doctorWhere =
      membership.role === "owner"
        ? and(
            eq(doctors.clinicId, input.clinicId),
            eq(doctors.active, true),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          )
        : and(
            eq(doctors.clinicId, input.clinicId),
            eq(doctors.clinicUserId, membership.id),
            eq(doctors.active, true),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          );

    const [catalogServices, catalogOffers, catalogDoctors] = await Promise.all([
      transaction.query.services.findMany({
        columns: { description: true, id: true, name: true },
        orderBy: (table, { asc }) => [asc(table.name)],
        where: eq(services.clinicId, input.clinicId),
      }),
      transaction.query.serviceOffers.findMany({
        columns: {
          active: true,
          bufferMinutes: true,
          doctorId: true,
          durationMinutes: true,
          id: true,
          priceUsd: true,
          serviceId: true,
        },
        where: eq(serviceOffers.clinicId, input.clinicId),
      }),
      transaction
        .select({ id: doctors.id, publicName: doctors.publicName })
        .from(doctors)
        .innerJoin(
          clinicUsers,
          and(
            eq(doctors.clinicId, clinicUsers.clinicId),
            eq(doctors.clinicUserId, clinicUsers.id),
          ),
        )
        .where(doctorWhere),
    ]);

    const visibleDoctorIds = new Set(catalogDoctors.map((doctor) => doctor.id));
    const visibleOffers =
      membership.role === "owner"
        ? catalogOffers
        : catalogOffers.filter((offer) => visibleDoctorIds.has(offer.doctorId));

    return {
      doctors: catalogDoctors.map((doctor) => ({
        id: doctor.id,
        publicName: doctor.publicName ?? "Médico sin nombre público",
      })),
      services: catalogServices.map((service) => ({
        ...service,
        offers: visibleOffers
          .filter((offer) => offer.serviceId === service.id)
          .map(({ serviceId: _, ...offer }) => offer),
      })),
    };
  });
}

async function ownerCanConfigure(
  transaction: Parameters<Parameters<typeof inClinicTransaction>[1]>[0],
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

async function canManageOffer(
  transaction: Parameters<Parameters<typeof inClinicTransaction>[1]>[0],
  input: { clinicId: string; doctorId: string; identityId: string },
) {
  const member = await transaction.query.clinicUsers.findFirst({
    columns: { id: true, role: true },
    where: and(
      eq(clinicUsers.clinicId, input.clinicId),
      eq(clinicUsers.identityId, input.identityId),
      eq(clinicUsers.active, true),
      inArray(clinicUsers.role, ["owner", "doctor"]),
    ),
  });
  if (member === undefined) return false;
  if (member.role === "owner") return true;
  const doctor = await transaction.query.doctors.findFirst({
    columns: { id: true },
    where: and(
      eq(doctors.id, input.doctorId),
      eq(doctors.clinicId, input.clinicId),
      eq(doctors.clinicUserId, member.id),
      eq(doctors.active, true),
    ),
  });
  return doctor !== undefined;
}

async function requireEligibleDoctors(
  transaction: Parameters<Parameters<typeof inClinicTransaction>[1]>[0],
  clinicId: string,
  doctorIds: string[],
) {
  const uniqueDoctorIds = [...new Set(doctorIds)];
  if (uniqueDoctorIds.length !== doctorIds.length) {
    throw new IneligibleServiceOfferDoctorError();
  }
  const eligibleDoctors = await transaction
    .select({ id: doctors.id })
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
        inArray(doctors.id, uniqueDoctorIds),
      ),
    );
  if (eligibleDoctors.length !== uniqueDoctorIds.length) {
    throw new IneligibleServiceOfferDoctorError();
  }
}

function offerAuditValues(offer: ServiceOffer) {
  return {
    active: String(offer.active),
    bufferMinutes: String(offer.bufferMinutes),
    doctorId: offer.doctorId,
    durationMinutes: String(offer.durationMinutes),
    priceUsd: offer.priceUsd,
  };
}
