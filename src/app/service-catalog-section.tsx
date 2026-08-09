"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";
import { CapacityConflicts } from "./capacity-conflicts";

export function ServiceCatalogSection({
  canCreateServices,
}: {
  canCreateServices: boolean;
}) {
  const [result, setResult] = useState<string>();
  const catalog = api.panacea.listServiceCatalog.useQuery();
  const create = api.panacea.createService.useMutation({
    onSuccess: (service) => {
      setResult(`Servicio ${service.name} creado.`);
      void catalog.refetch();
    },
  });
  const add = api.panacea.addServiceOffer.useMutation({
    onSuccess: () => {
      setResult("Oferta agregada al Servicio.");
      void catalog.refetch();
    },
  });
  const update = api.panacea.updateServiceOffer.useMutation({
    onSuccess: () => {
      setResult("Oferta actualizada para opciones nuevas.");
      void catalog.refetch();
    },
  });
  const deactivate = api.panacea.deactivateServiceOffer.useMutation({
    onSuccess: () => {
      setResult("Oferta desactivada sin borrar su historial.");
      void catalog.refetch();
    },
  });

  function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    create.mutate({
      description: value(data, "description"),
      name: value(data, "name"),
      offers: [
        {
          bufferMinutes: numberValue(data, "bufferMinutes"),
          doctorId: value(data, "doctorId"),
          durationMinutes: numberValue(data, "durationMinutes"),
          priceUsd: value(data, "priceUsd"),
        },
      ],
    });
  }

  function updateOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update.mutate({
      bufferMinutes: numberValue(data, "bufferMinutes"),
      durationMinutes: numberValue(data, "durationMinutes"),
      offerId: value(data, "offerId"),
      priceUsd: value(data, "priceUsd"),
    });
  }

  function addOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    add.mutate({
      bufferMinutes: numberValue(data, "bufferMinutes"),
      doctorId: value(data, "doctorId"),
      durationMinutes: numberValue(data, "durationMinutes"),
      priceUsd: value(data, "priceUsd"),
      serviceId: value(data, "serviceId"),
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Catálogo de Servicios</h2>
        <p className="mt-1 text-sm text-slate-300">
          Cada Servicio comienza con una Oferta activa de un Médico elegible.
        </p>
      </div>
      {canCreateServices ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={createService}>
          <label className="block text-sm">
            Servicio
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              maxLength={120}
              name="name"
              required
            />
          </label>
          <label className="block text-sm">
            Médico
            <select
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              disabled={catalog.data?.doctors.length === 0}
              name="doctorId"
              required
            >
              {catalog.data?.doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.publicName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            Descripción pública
            <textarea
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              maxLength={1000}
              name="description"
              required
            />
          </label>
          <label className="block text-sm">
            Precio (USD)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              inputMode="decimal"
              name="priceUsd"
              pattern="[0-9]+\.[0-9]{2}"
              placeholder="35.00"
              required
            />
          </label>
          <label className="block text-sm">
            Duración (minutos)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              defaultValue="30"
              min="5"
              name="durationMinutes"
              required
              step="5"
              type="number"
            />
          </label>
          <label className="block text-sm">
            Buffer posterior (minutos)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              defaultValue="0"
              min="0"
              name="bufferMinutes"
              required
              step="5"
              type="number"
            />
          </label>
          <button
            className="w-fit rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={create.isPending || catalog.data?.doctors.length === 0}
            type="submit"
          >
            {create.isPending ? "Creando…" : "Crear Servicio"}
          </button>
        </form>
      ) : null}
      {canCreateServices && catalog.data?.doctors.length === 0 ? (
        <p className="text-sm text-amber-300">
          Invite y active al menos un Médico antes de crear un Servicio.
        </p>
      ) : null}
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {(create.error ?? add.error ?? update.error ?? deactivate.error) ? (
        <div className="space-y-2 text-sm text-rose-300">
          <p>
            {
              (create.error ?? add.error ?? update.error ?? deactivate.error)
                ?.message
            }
          </p>
          <CapacityConflicts
            conflicts={deactivate.error?.data?.capacityConflicts}
          />
        </div>
      ) : null}
      <div className="space-y-3">
        {catalog.data?.services.map((service) => (
          <article
            className="rounded-lg border border-slate-800 p-4"
            key={service.id}
          >
            <h3 className="font-medium">{service.name}</h3>
            <p className="mt-1 text-sm text-slate-300">{service.description}</p>
            {canCreateServices ? (
              <form
                className="mt-3 grid items-end gap-2 rounded border border-slate-800 p-3 sm:grid-cols-4"
                onSubmit={addOffer}
              >
                <input name="serviceId" type="hidden" value={service.id} />
                <label className="text-sm">
                  Médico
                  <select
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                    name="doctorId"
                    required
                  >
                    {catalog.data?.doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.publicName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Precio (USD)
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                    defaultValue="0.00"
                    name="priceUsd"
                    pattern="[0-9]+\.[0-9]{2}"
                    required
                  />
                </label>
                <label className="text-sm">
                  Duración
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                    defaultValue="30"
                    min="5"
                    name="durationMinutes"
                    required
                    step="5"
                    type="number"
                  />
                </label>
                <label className="text-sm">
                  Buffer
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                    defaultValue="0"
                    min="0"
                    name="bufferMinutes"
                    required
                    step="5"
                    type="number"
                  />
                </label>
                <button
                  className="w-fit rounded border border-teal-300 px-3 py-1 text-sm text-teal-300 disabled:opacity-50"
                  disabled={add.isPending}
                  type="submit"
                >
                  {add.isPending ? "Agregando…" : "Agregar Oferta"}
                </button>
              </form>
            ) : null}
            <div className="mt-3 space-y-3">
              {service.offers.map((offer) => {
                const doctorName =
                  catalog.data?.doctors.find(
                    (doctor) => doctor.id === offer.doctorId,
                  )?.publicName ?? "Médico";
                return (
                  <form
                    aria-label={`Oferta de ${doctorName}`}
                    className="grid items-end gap-2 rounded border border-slate-800 p-3 sm:grid-cols-4"
                    key={offer.id}
                    onSubmit={updateOffer}
                  >
                    <input name="offerId" type="hidden" value={offer.id} />
                    <label className="text-sm">
                      Precio (USD)
                      <input
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                        defaultValue={offer.priceUsd}
                        disabled={!offer.active}
                        name="priceUsd"
                        pattern="[0-9]+\.[0-9]{2}"
                        required
                      />
                    </label>
                    <label className="text-sm">
                      Duración
                      <input
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                        defaultValue={offer.durationMinutes}
                        disabled={!offer.active}
                        min="5"
                        name="durationMinutes"
                        required
                        step="5"
                        type="number"
                      />
                    </label>
                    <label className="text-sm">
                      Buffer
                      <input
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                        defaultValue={offer.bufferMinutes}
                        disabled={!offer.active}
                        min="0"
                        name="bufferMinutes"
                        required
                        step="5"
                        type="number"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded border border-teal-300 px-3 py-1 text-sm text-teal-300 disabled:opacity-50"
                        disabled={!offer.active || update.isPending}
                        type="submit"
                      >
                        Guardar
                      </button>
                      <button
                        className="rounded border border-rose-300 px-3 py-1 text-sm text-rose-300 disabled:opacity-50"
                        disabled={!offer.active || deactivate.isPending}
                        onClick={() => deactivate.mutate({ offerId: offer.id })}
                        type="button"
                      >
                        {offer.active ? "Desactivar" : "Desactivada"}
                      </button>
                    </div>
                  </form>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function numberValue(data: FormData, field: string) {
  return Number(value(data, field));
}

function value(data: FormData, field: string) {
  const formValue = data.get(field);
  return typeof formValue === "string" ? formValue : "";
}
