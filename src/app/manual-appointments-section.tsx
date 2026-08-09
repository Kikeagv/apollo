"use client";

import { type FormEvent, useMemo, useState } from "react";

import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import { api } from "~/trpc/react";

type CalendarView = "day" | "week";
type CalendarAppointment = {
  bufferMinutes: number | null;
  contacts: { id: string; name: string; phoneE164: string }[];
  doctor: { id: string; name: string };
  durationMinutes: number | null;
  endsAt: Date;
  events: {
    actorClinicUserId: string;
    occurredAt: Date;
    type: "manual-created";
  }[];
  id: string;
  patient: { id: string; name: string };
  priceUsd: string | null;
  outsideSchedule: boolean;
  service: { name: string };
  startsAt: Date;
};

type ManualAppointmentRequest = {
  doctorId: string;
  outsideScheduleConfirmed?: boolean;
  patientId: string;
  serviceOfferId: string;
  startsAt: Date;
};

/** Calendario operativo y alta de Citas manuales autorizadas por la Agenda. */
export function ManualAppointmentsSection() {
  const [calendarDate, setCalendarDate] = useState(today());
  const [doctorId, setDoctorId] = useState("");
  const [outsideScheduleConfirmation, setOutsideScheduleConfirmation] =
    useState<ManualAppointmentRequest>();
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<CalendarView>("week");
  const formData = api.panacea.listManualAppointmentFormData.useQuery();
  const appointments = api.panacea.listManualAppointments.useQuery();
  const create = api.panacea.createManualAppointment.useMutation({
    onError: (error, input) => {
      if (error.data?.outsideScheduleConfirmationRequired) {
        setOutsideScheduleConfirmation(input);
      }
    },
    onSuccess: async (appointment) => {
      setOutsideScheduleConfirmation(undefined);
      setSelectedId(appointment.id);
      await appointments.refetch();
    },
  });
  const selected = appointments.data?.find(
    (appointment) => appointment.id === selectedId,
  );
  const doctors = useMemo(
    () => [
      ...new Map(
        formData.data?.offers.map((offer) => [
          offer.doctorId,
          { id: offer.doctorId, name: offer.doctorName },
        ]) ?? [],
      ).values(),
    ],
    [formData.data],
  );
  const visibleDates =
    view === "week" ? calendarWeek(calendarDate) : [calendarDate];
  const calendarAppointments =
    appointments.data?.filter(
      (appointment) =>
        visibleDates.includes(localDate(appointment.startsAt)) &&
        (doctorId === "" || appointment.doctor.id === doctorId),
    ) ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const offer = formData.data?.offers.find(
      (item) => item.serviceOfferId === value(data, "serviceOfferId"),
    );
    if (offer === undefined) return;
    setOutsideScheduleConfirmation(undefined);
    create.mutate({
      doctorId: offer.doctorId,
      patientId: value(data, "patientId"),
      serviceOfferId: offer.serviceOfferId,
      startsAt: clinicDateTime(value(data, "startsAt")),
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Calendario</h2>
        <p className="mt-1 text-sm text-slate-300">
          Opere Citas manuales y consulte la agenda de la Clínica.
        </p>
      </div>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={submit}>
        <label className="text-sm">
          Paciente
          <select
            className={inputClass}
            disabled={formData.data?.patients.length === 0}
            name="patientId"
            required
          >
            <option value="">Seleccione un Paciente</option>
            {formData.data?.patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Oferta de servicio
          <select
            className={inputClass}
            disabled={formData.data?.offers.length === 0}
            name="serviceOfferId"
            required
          >
            <option value="">Seleccione una Oferta</option>
            {formData.data?.offers.map((offer) => (
              <option key={offer.serviceOfferId} value={offer.serviceOfferId}>
                {offer.doctorName} · {offer.serviceName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Inicio
          <input
            className={inputClass}
            name="startsAt"
            required
            type="datetime-local"
          />
        </label>
        <button
          className={buttonClass}
          disabled={
            create.isPending ||
            formData.data?.patients.length === 0 ||
            formData.data?.offers.length === 0
          }
          type="submit"
        >
          {create.isPending ? "Validando…" : "Crear Cita manual"}
        </button>
      </form>
      {formData.data?.patients.length === 0 ? (
        <p className="text-sm text-amber-300">
          Registre y vincule al menos un Contacto antes de crear la Cita.
        </p>
      ) : null}
      {create.error ? (
        <p className="text-sm text-rose-300">{create.error.message}</p>
      ) : null}
      {outsideScheduleConfirmation ? (
        <div className="space-y-2 rounded border border-amber-500/70 p-3 text-sm text-amber-100">
          <p>
            La Cita no cabe por completo en el Horario vigente. Confirme la
            excepción para crearla sin modificar los demás controles de
            capacidad.
          </p>
          <button
            className={secondaryButtonClass}
            disabled={create.isPending}
            onClick={() =>
              create.mutate({
                ...outsideScheduleConfirmation,
                outsideScheduleConfirmed: true,
              })
            }
            type="button"
          >
            Confirmar Cita fuera de horario
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Fecha
              <input
                className={inputClass}
                onChange={(event) => setCalendarDate(event.target.value)}
                type="date"
                value={calendarDate}
              />
            </label>
            <label className="text-sm">
              Médico
              <select
                className={inputClass}
                onChange={(event) => setDoctorId(event.target.value)}
                value={doctorId}
              >
                <option value="">Todos los Médicos</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-1">
              <button
                className={
                  view === "week" ? activeButtonClass : secondaryButtonClass
                }
                onClick={() => setView("week")}
                type="button"
              >
                Semana
              </button>
              <button
                className={
                  view === "day" ? activeButtonClass : secondaryButtonClass
                }
                onClick={() => setView("day")}
                type="button"
              >
                Día
              </button>
            </div>
          </div>
          <div
            className={
              view === "week"
                ? "grid gap-2 sm:grid-cols-2 xl:grid-cols-7"
                : "grid gap-2"
            }
          >
            {visibleDates.map((date) => (
              <div
                className="min-h-32 rounded border border-slate-800 p-2"
                key={date}
              >
                <h3 className="mb-2 text-sm font-medium">{formatDay(date)}</h3>
                <ul className="space-y-2">
                  {calendarAppointments
                    .filter(
                      (appointment) => localDate(appointment.startsAt) === date,
                    )
                    .map((appointment) => (
                      <li key={appointment.id}>
                        <button
                          className="w-full rounded border border-teal-800 p-2 text-left text-sm hover:border-teal-300"
                          onClick={() => setSelectedId(appointment.id)}
                          type="button"
                        >
                          <span className="block font-medium">
                            {formatTime(appointment.startsAt)} ·{" "}
                            {appointment.patient.name}
                          </span>
                          <span className="block text-slate-300">
                            {appointment.service.name}
                          </span>
                          {appointment.outsideSchedule ? (
                            <span className="block text-amber-300">
                              Fuera de horario
                            </span>
                          ) : null}
                          {doctorId === "" ? (
                            <span className="block text-slate-400">
                              {appointment.doctor.name}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <AppointmentDetail appointment={selected} />
      </div>
    </section>
  );
}

function AppointmentDetail({
  appointment,
}: {
  appointment: CalendarAppointment | undefined;
}) {
  if (appointment === undefined) {
    return (
      <aside className="rounded border border-slate-800 p-3 text-sm text-slate-400">
        Seleccione una Cita para ver su detalle.
      </aside>
    );
  }
  return (
    <aside className="space-y-3 rounded border border-slate-700 p-3 text-sm">
      <h3 className="font-semibold">Detalle de la Cita</h3>
      <dl className="space-y-1">
        <Detail label="Paciente" value={appointment.patient.name} />
        <Detail
          label="Contacto"
          value={appointment.contacts
            .map((contact) => `${contact.name} · ${contact.phoneE164}`)
            .join(", ")}
        />
        <Detail label="Médico" value={appointment.doctor.name} />
        <Detail label="Servicio" value={appointment.service.name} />
        <Detail
          label="Horario"
          value={`${formatClinicDate(appointment.startsAt)} a ${formatTime(appointment.endsAt)}`}
        />
        <Detail label="Precio cotizado" value={`US$ ${appointment.priceUsd}`} />
        {appointment.outsideSchedule ? (
          <Detail label="Capacidad" value="Cita fuera de horario" />
        ) : null}
      </dl>
      <div>
        <h4 className="font-medium">Eventos de Cita</h4>
        <ul className="mt-1 space-y-1 text-slate-300">
          {appointment.events.map((event) => (
            <li key={`${event.type}-${event.occurredAt.toString()}`}>
              {event.type === "manual-created"
                ? "Cita manual creada"
                : event.type}{" "}
              · {formatClinicDate(event.occurredAt)}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd>{value || "Sin Contacto vinculado"}</dd>
    </div>
  );
}

function calendarWeek(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(value);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function clinicDateTime(value: string) {
  return new Date(`${value}:00${CLINIC_UTC_OFFSET}`);
}

function formatClinicDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    day: "numeric",
    month: "short",
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
  }).format(new Date(`${value}T12:00:00${CLINIC_UTC_OFFSET}`));
}

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}

function localDate(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function today() {
  return localDate(new Date());
}

function value(data: FormData, field: string) {
  const formValue = data.get(field);
  return typeof formValue === "string" ? formValue : "";
}

const inputClass =
  "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2";
const buttonClass =
  "w-fit self-end rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50";
const activeButtonClass =
  "rounded bg-teal-300 px-3 py-2 text-sm font-medium text-slate-950";
const secondaryButtonClass =
  "rounded border border-slate-600 px-3 py-2 text-sm";
