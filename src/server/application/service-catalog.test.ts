import { describe, expect, it, vi } from "vitest";

import {
  addServiceOffer,
  createService,
  deactivateServiceOffer,
  type ServiceCatalogStore,
  type ServiceCatalogUpdater,
  updateService,
  updateServiceOffer,
} from "./service-catalog";

describe("configurar el catálogo de Servicios", () => {
  it("crea un Servicio normalizado junto con una Oferta activa elegible", async () => {
    const create = vi.fn().mockResolvedValue({
      description: "Consulta médica general",
      id: "service-1",
      name: "Consulta inicial",
      offers: [
        {
          bufferMinutes: 10,
          doctorId: "doctor-1",
          durationMinutes: 45,
          id: "offer-1",
          priceUsd: "35.00",
        },
      ],
    });
    const store: ServiceCatalogStore = { create };

    await expect(
      createService(
        {
          clinicId: "clinic-1",
          description: "  Consulta médica general  ",
          identityId: "owner-1",
          name: "  Consulta   inicial  ",
          offers: [
            {
              bufferMinutes: 10,
              doctorId: "doctor-1",
              durationMinutes: 45,
              priceUsd: "35.00",
            },
          ],
        },
        store,
      ),
    ).resolves.toMatchObject({
      id: "service-1",
      name: "Consulta inicial",
    });

    expect(create).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      description: "Consulta médica general",
      identityId: "owner-1",
      name: "Consulta inicial",
      normalizedName: "consulta inicial",
      offers: [
        {
          bufferMinutes: 10,
          doctorId: "doctor-1",
          durationMinutes: 45,
          priceUsd: "35.00",
        },
      ],
    });
  });

  it("desactiva una Oferta sin borrar su configuración histórica", async () => {
    const deactivate = vi.fn().mockResolvedValue({
      active: false,
      bufferMinutes: 10,
      doctorId: "doctor-1",
      durationMinutes: 45,
      id: "offer-1",
      priceUsd: "35.00",
    });

    await expect(
      deactivateServiceOffer(
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          offerId: "offer-1",
        },
        { deactivate },
      ),
    ).resolves.toMatchObject({ active: false, id: "offer-1" });

    expect(deactivate).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
      offerId: "offer-1",
    });
  });

  it("rechaza una Oferta con duración o buffer fuera de la cuadrícula", async () => {
    const create = vi.fn();

    await expect(
      createService(
        {
          clinicId: "clinic-1",
          description: "Consulta médica general",
          identityId: "owner-1",
          name: "Consulta inicial",
          offers: [
            {
              bufferMinutes: 0,
              doctorId: "doctor-1",
              durationMinutes: 43,
              priceUsd: "35.00",
            },
          ],
        },
        { create },
      ),
    ).rejects.toThrow("La duración debe ser múltiplo de cinco minutos");

    expect(create).not.toHaveBeenCalled();
  });

  it("rechaza un precio no exacto y un buffer fuera de la cuadrícula", async () => {
    const create = vi.fn();
    const baseInput = {
      clinicId: "clinic-1",
      description: "Consulta médica general",
      identityId: "owner-1",
      name: "Consulta inicial",
    };

    await expect(
      createService(
        {
          ...baseInput,
          offers: [
            {
              bufferMinutes: 7,
              doctorId: "doctor-1",
              durationMinutes: 45,
              priceUsd: "35.00",
            },
          ],
        },
        { create },
      ),
    ).rejects.toThrow("El buffer debe ser múltiplo de cinco minutos");
    await expect(
      createService(
        {
          ...baseInput,
          offers: [
            {
              bufferMinutes: 5,
              doctorId: "doctor-1",
              durationMinutes: 45,
              priceUsd: "35",
            },
          ],
        },
        { create },
      ),
    ).rejects.toThrow("El precio debe expresarse en USD con dos decimales");

    expect(create).not.toHaveBeenCalled();
  });

  it("actualiza los valores que aplicarán a las opciones nuevas", async () => {
    const update = vi.fn().mockResolvedValue({
      active: true,
      bufferMinutes: 15,
      doctorId: "doctor-1",
      durationMinutes: 50,
      id: "offer-1",
      priceUsd: "40.00",
    });

    await expect(
      updateServiceOffer(
        {
          bufferMinutes: 15,
          clinicId: "clinic-1",
          durationMinutes: 50,
          identityId: "owner-1",
          offerId: "offer-1",
          priceUsd: "40.00",
        },
        { update },
      ),
    ).resolves.toMatchObject({
      bufferMinutes: 15,
      durationMinutes: 50,
      priceUsd: "40.00",
    });
  });

  it("agrega una Oferta activa a un Servicio existente para otro Médico", async () => {
    const add = vi.fn().mockResolvedValue({
      active: true,
      bufferMinutes: 5,
      doctorId: "doctor-2",
      durationMinutes: 30,
      id: "offer-2",
      priceUsd: "30.00",
    });

    await expect(
      addServiceOffer(
        {
          bufferMinutes: 5,
          clinicId: "clinic-1",
          doctorId: "doctor-2",
          durationMinutes: 30,
          identityId: "owner-1",
          priceUsd: "30.00",
          serviceId: "service-1",
        },
        { add },
      ),
    ).resolves.toMatchObject({ id: "offer-2", priceUsd: "30.00" });

    expect(add).toHaveBeenCalledWith({
      bufferMinutes: 5,
      clinicId: "clinic-1",
      doctorId: "doctor-2",
      durationMinutes: 30,
      identityId: "owner-1",
      priceUsd: "30.00",
      serviceId: "service-1",
    });
  });

  it("edita el nombre y la descripción pública de un Servicio", async () => {
    const updateServicePersistence = vi.fn().mockResolvedValue({
      description: "Seguimiento especializado",
      id: "service-1",
      name: "  Seguimiento especializado  ",
      offers: [],
    });
    const store: ServiceCatalogUpdater = {
      updateService: updateServicePersistence,
    };

    await expect(
      updateService(
        {
          clinicId: "clinic-1",
          description: "  Seguimiento especializado  ",
          identityId: "owner-1",
          name: "  Seguimiento   especializado  ",
          serviceId: "service-1",
        },
        store,
      ),
    ).resolves.toMatchObject({ id: "service-1" });

    expect(updateServicePersistence).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      description: "Seguimiento especializado",
      identityId: "owner-1",
      name: "Seguimiento especializado",
      normalizedName: "seguimiento especializado",
      serviceId: "service-1",
    });
  });

  it("valida la edición pública antes de tocar persistencia", async () => {
    const updateServicePersistence = vi.fn();

    await expect(
      updateService(
        {
          clinicId: "clinic-1",
          description: "Descripción válida",
          identityId: "owner-1",
          name: "   ",
          serviceId: "service-1",
        },
        { updateService: updateServicePersistence },
      ),
    ).rejects.toThrow("El nombre del Servicio es obligatorio");

    expect(updateServicePersistence).not.toHaveBeenCalled();
  });
});
