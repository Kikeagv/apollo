import { and, eq, inArray, sql } from "drizzle-orm";

import {
  type ServiceCatalogStore,
  type ServiceOfferCreator,
  type ServiceOffer,
  type ServiceOfferDeactivator,
  type ServiceOfferUpdater,
} from "~/server/application/service-catalog";
import { inClinicTransaction } from "~/server/db/clinic-context";
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

      return { ...service, offers: createdOffers };
    });
  },

  async add(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await ownerCanConfigure(transaction, input))) return undefined;

      const service = await transaction.query.services.findFirst({
        columns: { id: true },
        where: and(
          eq(services.id, input.serviceId),
          eq(services.clinicId, input.clinicId),
        ),
      });
      if (service === undefined) return undefined;
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
      return offer;
    });
  },

  async update(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await canManageOffers(transaction, input))) return undefined;

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
      return updated;
    });
  },

  async deactivate(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await canManageOffers(transaction, input))) return undefined;

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

      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${offer.serviceId}))`,
      );
      const activeOffers = await transaction.query.serviceOffers.findMany({
        columns: { id: true },
        where: and(
          eq(serviceOffers.serviceId, offer.serviceId),
          eq(serviceOffers.active, true),
        ),
      });
      if (activeOffers.length <= 1) throw new LastActiveServiceOfferError();

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
      return deactivated as ServiceOffer & { active: false };
    });
  },
};

export async function listServiceCatalog(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    if (!(await canManageOffers(transaction, input))) return undefined;

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
        .where(
          and(
            eq(doctors.clinicId, input.clinicId),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          ),
        ),
    ]);

    return {
      doctors: catalogDoctors.map((doctor) => ({
        id: doctor.id,
        publicName: doctor.publicName ?? "Médico sin nombre público",
      })),
      services: catalogServices.map((service) => ({
        ...service,
        offers: catalogOffers
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
      eq(clinicUsers.role, "owner"),
    ),
  });
  return owner !== undefined;
}

async function canManageOffers(
  transaction: Parameters<Parameters<typeof inClinicTransaction>[1]>[0],
  input: { clinicId: string; identityId: string },
) {
  const member = await transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, input.clinicId),
      eq(clinicUsers.identityId, input.identityId),
      inArray(clinicUsers.role, ["owner", "doctor"]),
    ),
  });
  return member !== undefined;
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
