"use client";

import { type FormEvent, useState } from "react";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import type { CareOptionsRequest } from "~/server/application/care-options";
import { api } from "~/trpc/react";

type CareOptionsSearch = Omit<CareOptionsRequest, "clinicId" | "identityId">;

/** Vista de Panacea sobre la misma consulta de Agenda que usarán los demás flujos. */
export function CareOptionsSection() {
  const [doctorId, setDoctorId] = useState("");
  const [request, setRequest] = useState<CareOptionsSearch>();
  const configuration = api.panacea.listAvailabilityConfiguration.useQuery();
  const catalog = api.panacea.listServiceCatalog.useQuery();
  const options = api.panacea.listCareOptions.useQuery(
    request ?? { doctorId: "", from: today(), serviceId: "", to: today() },
    { enabled: request !== undefined },
  );
  const services =
    catalog.data?.services.filter((service) =>
      service.offers.some(
        (offer) => offer.active && offer.doctorId === doctorId,
      ),
    ) ?? [];

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRequest({
      doctorId: value(data, "doctorId"),
      from: value(data, "from"),
      serviceId: value(data, "serviceId"),
      to: value(data, "to"),
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Opciones de atención</h2>
        <p className="mt-1 text-sm text-slate-300">
          La Agenda calcula esta disponibilidad en {CLINIC_TIMEZONE}; no hay
          slots materializados.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={search}>
        <label className="block text-sm">
          Médico
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            name="doctorId"
            onChange={(event) => setDoctorId(event.target.value)}
            required
            value={doctorId}
          >
            <option value="">Seleccione un Médico</option>
            {configuration.data?.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.publicName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Servicio
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            disabled={doctorId === "" || services.length === 0}
            name="serviceId"
            required
          >
            <option value="">Seleccione un Servicio</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Desde
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            defaultValue={today()}
            name="from"
            required
            type="date"
          />
        </label>
        <label className="block text-sm">
          Hasta
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            defaultValue={today()}
            name="to"
            required
            type="date"
          />
        </label>
        <button
          className="w-fit rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            doctorId === "" || services.length === 0 || options.isFetching
          }
          type="submit"
        >
          {options.isFetching ? "Calculando…" : "Consultar Opciones"}
        </button>
      </form>
      {doctorId !== "" && services.length === 0 ? (
        <p className="text-sm text-amber-300">
          Este Médico sigue visible en Panacea, pero no tiene una Oferta activa.
        </p>
      ) : null}
      {options.error ? (
        <p className="text-sm text-rose-300">{options.error.message}</p>
      ) : null}
      {request && options.data?.length === 0 ? (
        <p className="text-sm text-slate-300">
          No hay Opciones de atención para ese rango.
        </p>
      ) : null}
      {options.data && options.data.length > 0 ? (
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {options.data.map((option) => (
            <li
              className="rounded border border-slate-800 p-2"
              key={option.startsAt.toISOString()}
            >
              {new Intl.DateTimeFormat("es-SV", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: CLINIC_TIMEZONE,
              }).format(option.startsAt)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function value(data: FormData, field: string) {
  const formValue = data.get(field);
  return typeof formValue === "string" ? formValue : "";
}
