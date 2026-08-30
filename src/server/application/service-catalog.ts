const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_SERVICE_NAME_LENGTH = 120;

export type ServiceOfferConfiguration = {
  bufferMinutes: number;
  doctorId: string;
  durationMinutes: number;
  priceUsd: string;
};

export type ServiceOffer = ServiceOfferConfiguration & {
  active: boolean;
  id: string;
};

export type ClinicService = {
  description: string;
  id: string;
  name: string;
  offers: ServiceOffer[];
};

export type ServiceCatalogStore = {
  create(input: {
    clinicId: string;
    description: string;
    identityId: string;
    name: string;
    normalizedName: string;
    offers: ServiceOfferConfiguration[];
  }): Promise<ClinicService | undefined>;
};

export type ServiceCatalogUpdater = {
  updateService(input: {
    clinicId: string;
    description: string;
    identityId: string;
    name: string;
    normalizedName: string;
    serviceId: string;
  }): Promise<ClinicService | undefined>;
};

export type ServiceOfferDeactivator = {
  deactivate(input: {
    clinicId: string;
    identityId: string;
    offerId: string;
  }): Promise<(ServiceOffer & { active: false }) | undefined>;
};

export type ServiceOfferUpdater = {
  update(input: {
    bufferMinutes: number;
    clinicId: string;
    durationMinutes: number;
    identityId: string;
    offerId: string;
    priceUsd: string;
  }): Promise<ServiceOffer | undefined>;
};

export type ServiceOfferCreator = {
  add(
    input: ServiceOfferConfiguration & {
      clinicId: string;
      identityId: string;
      serviceId: string;
    },
  ): Promise<ServiceOffer | undefined>;
};

export class ServiceCatalogAccessError extends Error {
  constructor() {
    super("Solo el Médico propietario puede configurar el catálogo");
    this.name = "ServiceCatalogAccessError";
  }
}

/** Crea un Servicio público solo cuando nace con al menos una Oferta activa. */
export async function createService(
  input: {
    clinicId: string;
    description: string;
    identityId: string;
    name: string;
    offers: ServiceOfferConfiguration[];
  },
  store: ServiceCatalogStore,
) {
  const name = requiredText(
    input.name,
    "El nombre del Servicio es obligatorio",
    MAX_SERVICE_NAME_LENGTH,
  );
  const description = requiredText(
    input.description,
    "La descripción pública es obligatoria",
    MAX_DESCRIPTION_LENGTH,
  );
  if (input.offers.length === 0) {
    throw new Error("El Servicio requiere al menos una Oferta activa");
  }

  const offers = input.offers.map(normalizeOffer);
  const service = await store.create({
    clinicId: input.clinicId,
    description,
    identityId: input.identityId,
    name,
    normalizedName: normalizeServiceName(name),
    offers,
  });
  if (service === undefined) throw new ServiceCatalogAccessError();
  return service;
}

/** Actualiza la identidad pública de un Servicio sin tocar sus Ofertas. */
export async function updateService(
  input: {
    clinicId: string;
    description: string;
    identityId: string;
    name: string;
    serviceId: string;
  },
  store: ServiceCatalogUpdater,
) {
  const name = requiredText(
    input.name,
    "El nombre del Servicio es obligatorio",
    MAX_SERVICE_NAME_LENGTH,
  );
  const description = requiredText(
    input.description,
    "La descripción pública es obligatoria",
    MAX_DESCRIPTION_LENGTH,
  );
  const service = await store.updateService({
    clinicId: input.clinicId,
    description,
    identityId: input.identityId,
    name,
    normalizedName: normalizeServiceName(name),
    serviceId: input.serviceId,
  });
  if (service === undefined) throw new ServiceCatalogAccessError();
  return service;
}

/** Añade otro Médico elegible a un Servicio ya publicado en la Clínica. */
export async function addServiceOffer(
  input: ServiceOfferConfiguration & {
    clinicId: string;
    identityId: string;
    serviceId: string;
  },
  store: ServiceOfferCreator,
) {
  const offer = await store.add({ ...input, ...normalizeOffer(input) });
  if (offer === undefined) throw new ServiceCatalogAccessError();
  return offer;
}

/** Cierra una Oferta sin eliminar su configuración ni alterar Citas existentes. */
export async function deactivateServiceOffer(
  input: { clinicId: string; identityId: string; offerId: string },
  store: ServiceOfferDeactivator,
) {
  const offer = await store.deactivate(input);
  if (offer === undefined) throw new ServiceCatalogAccessError();
  return offer;
}

/** Actualiza los parámetros que la Agenda aplicará a opciones futuras. */
export async function updateServiceOffer(
  input: {
    bufferMinutes: number;
    clinicId: string;
    durationMinutes: number;
    identityId: string;
    offerId: string;
    priceUsd: string;
  },
  store: ServiceOfferUpdater,
) {
  const offer = await store.update({
    ...input,
    ...normalizeOffer(input),
  });
  if (offer === undefined) throw new ServiceCatalogAccessError();
  return offer;
}

function normalizeOffer<
  T extends Pick<
    ServiceOfferConfiguration,
    "bufferMinutes" | "durationMinutes" | "priceUsd"
  >,
>(input: T) {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("La duración debe ser un número positivo de minutos");
  }
  if (input.durationMinutes % 5 !== 0) {
    throw new Error("La duración debe ser múltiplo de cinco minutos");
  }
  if (!Number.isInteger(input.bufferMinutes) || input.bufferMinutes < 0) {
    throw new Error("El buffer debe ser un número de minutos no negativo");
  }
  if (input.bufferMinutes % 5 !== 0) {
    throw new Error("El buffer debe ser múltiplo de cinco minutos");
  }
  if (!/^\d+(?:\.\d{2})$/.test(input.priceUsd)) {
    throw new Error("El precio debe expresarse en USD con dos decimales");
  }
  return input;
}

function normalizeServiceName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("es-SV");
}

function requiredText(value: string, message: string, maximumLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new Error(message);
  if (normalized.length > maximumLength) {
    throw new Error(`El valor no puede exceder ${maximumLength} caracteres`);
  }
  return normalized;
}
