"use client";

import { type FormEvent, useMemo, useState } from "react";

import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import type {
  AgendaAppointment,
  AppointmentEventType,
  CalendarBlock,
  CalendarEntry,
} from "~/server/application/manual-appointments";
import { api } from "~/trpc/react";

type CalendarView = "day" | "week";
type CalendarAppointment = AgendaAppointment;

type ManualAppointmentRequest = {
  doctorId: string;
  notificationRecipientContactId?: string;
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
  const [patientId, setPatientId] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const [view, setView] = useState<CalendarView>("week");
  const formData = api.panacea.listManualAppointmentFormData.useQuery();
  const cancelledAppointments =
    api.panacea.listCancelledManualAppointments.useQuery();
  const visibleDates =
    view === "week" ? calendarWeek(calendarDate) : [calendarDate];
  const calendarPeriod = calendarPeriodFor(visibleDates);
  const calendarAgenda = api.panacea.listPanaceaCalendar.useQuery({
    doctorId: doctorId || undefined,
    ...calendarPeriod,
  });
  const create = api.panacea.createManualAppointment.useMutation({
    onError: (error, input) => {
      if (error.data?.outsideScheduleConfirmationRequired) {
        setOutsideScheduleConfirmation(input);
      }
    },
    onSuccess: async (appointment) => {
      setOutsideScheduleConfirmation(undefined);
      setSelectedId(appointment.id);
      await calendarAgenda.refetch();
    },
  });
  const cancel = api.panacea.cancelManualAppointment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        cancelledAppointments.refetch(),
        calendarAgenda.refetch(),
      ]);
    },
  });
  const selected = [
    ...(calendarAgenda.data ?? []),
    ...(cancelledAppointments.data ?? []),
  ].find((appointment) => appointment.id === selectedId);
  const doctors = useMemo(() => {
    const doctorsById = new Map<string, { id: string; name: string }>();
    for (const offer of formData.data?.offers ?? []) {
      doctorsById.set(offer.doctorId, {
        id: offer.doctorId,
        name: offer.doctorName,
      });
    }
    for (const entry of calendarAgenda.data ?? []) {
      doctorsById.set(entry.doctor.id, entry.doctor);
    }
    return [...doctorsById.values()];
  }, [calendarAgenda.data, formData.data]);
  const calendarEntries = calendarAgenda.data ?? [];
  const selectedPatient = formData.data?.patients.find(
    (patient) => patient.id === patientId,
  );

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
      notificationRecipientContactId: sendConfirmation
        ? value(data, "notificationRecipientContactId")
        : undefined,
      patientId,
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
            onChange={(event) => setPatientId(event.target.value)}
            required
            value={patientId}
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
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            checked={sendConfirmation}
            onChange={(event) => setSendConfirmation(event.target.checked)}
            type="checkbox"
          />
          Enviar confirmación inmediata por WhatsApp
        </label>
        {sendConfirmation ? (
          <label className="text-sm sm:col-span-2">
            Contacto destinatario
            <select
              className={inputClass}
              disabled={selectedPatient === undefined}
              name="notificationRecipientContactId"
              required
            >
              <option value="">Seleccione un Contacto vinculado</option>
              {selectedPatient?.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} · {contact.phoneE164}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
      {cancelledAppointments.data?.length ? (
        <div className="space-y-2 rounded border border-slate-800 p-3 text-sm">
          <h3 className="font-medium">Citas canceladas</h3>
          <ul className="space-y-1">
            {cancelledAppointments.data.map((appointment) => (
              <li key={appointment.id}>
                <button
                  className="text-left text-amber-300 underline-offset-2 hover:underline"
                  onClick={() => setSelectedId(appointment.id)}
                  type="button"
                >
                  {formatClinicDate(appointment.startsAt)} ·{" "}
                  {appointment.patient.name} · {appointment.service.name}
                </button>
              </li>
            ))}
          </ul>
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
                  {calendarEntries
                    .filter((entry) => localDate(entry.startsAt) === date)
                    .map((entry) =>
                      isCalendarBlock(entry) ? (
                        <li key={`block-${entry.id}`}>
                          <button
                            className="w-full rounded border border-amber-800 p-2 text-left text-sm hover:border-amber-300"
                            onClick={() => setSelectedId(entry.id)}
                            type="button"
                          >
                            <span className="block font-medium">
                              {formatTime(entry.startsAt)} · Bloqueo
                            </span>
                            {entry.privateLabel ? (
                              <span className="block text-amber-200">
                                {entry.privateLabel}
                              </span>
                            ) : null}
                            {doctorId === "" ? (
                              <span className="block text-slate-400">
                                {entry.doctor.name}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ) : (
                        <li key={`appointment-${entry.id}`}>
                          <button
                            className="w-full rounded border border-teal-800 p-2 text-left text-sm hover:border-teal-300"
                            onClick={() => setSelectedId(entry.id)}
                            type="button"
                          >
                            <span className="block font-medium">
                              {formatTime(entry.startsAt)} ·{" "}
                              {entry.patient.name}
                            </span>
                            <span className="block text-slate-300">
                              {entry.service.name}
                            </span>
                            {entry.outsideSchedule ? (
                              <span className="block text-amber-300">
                                Fuera de horario
                              </span>
                            ) : null}
                            {doctorId === "" ? (
                              <span className="block text-slate-400">
                                {entry.doctor.name}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ),
                    )}
                </ul>
              </div>
            ))}
          </div>
        </div>
        {isCalendarBlock(selected) ? (
          <AvailabilityBlockDetail block={selected} />
        ) : (
          <AppointmentDetail
            appointment={selected}
            cancelError={cancel.error?.message}
            cancelling={cancel.isPending}
            onCancel={(input) => {
              if (selected !== undefined) {
                cancel.mutate({
                  appointmentId: selected.id,
                  ...input,
                });
              }
            }}
          />
        )}
      </div>
    </section>
  );
}

function AvailabilityBlockDetail({ block }: { block: CalendarBlock }) {
  return (
    <aside className="space-y-3 rounded border border-amber-800 p-3 text-sm">
      <h3 className="font-semibold">Detalle del Bloqueo</h3>
      <dl className="space-y-1">
        <Detail label="Médico" value={block.doctor.name} />
        <Detail
          label="Horario"
          value={`${formatClinicDate(block.startsAt)} a ${formatTime(block.endsAt)}`}
        />
        <Detail label="Etiqueta privada" value={block.privateLabel ?? ""} />
      </dl>
    </aside>
  );
}

function AppointmentDetail({
  appointment,
  cancelError,
  cancelling,
  onCancel,
}: {
  appointment: CalendarAppointment | undefined;
  cancelError: string | undefined;
  cancelling: boolean;
  onCancel: (input: {
    notificationRecipientContactId?: string;
    reason?: string;
  }) => void;
}) {
  const [sendCancellation, setSendCancellation] = useState(false);
  if (appointment === undefined) {
    return (
      <aside className="rounded border border-slate-800 p-3 text-sm text-slate-400">
        Seleccione una Cita para ver su detalle.
      </aside>
    );
  }
  function cancelAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onCancel({
      notificationRecipientContactId: sendCancellation
        ? value(data, "notificationRecipientContactId")
        : undefined,
      reason: value(data, "reason") || undefined,
    });
  }
  const canCancel =
    appointment.status === "confirmed" && appointment.startsAt > new Date();
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
        <Detail
          label="Estado"
          value={
            appointment.status === "cancelled" ? "Cancelada" : "Confirmada"
          }
        />
        {appointment.outsideSchedule ? (
          <Detail label="Capacidad" value="Cita fuera de horario" />
        ) : null}
      </dl>
      <div>
        <h4 className="font-medium">Eventos de Cita</h4>
        <ul className="mt-1 space-y-1 text-slate-300">
          {appointment.events.map((event) => (
            <li key={`${event.type}-${event.occurredAt.toString()}`}>
              {appointmentEventLabel(event.type)}
              {event.recipient
                ? ` · ${event.recipient.name} · ${event.recipient.phoneE164}`
                : ""}
              {event.reason ? ` · ${event.reason}` : ""} · Usuario de clínica{" "}
              {event.actorClinicUserId} · {formatClinicDate(event.occurredAt)}
            </li>
          ))}
        </ul>
      </div>
      {canCancel ? (
        <form className="grid gap-2" onSubmit={cancelAppointment}>
          <label className="text-sm">
            Razón de cancelación (opcional)
            <input className={inputClass} maxLength={500} name="reason" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={sendCancellation}
              onChange={(event) => setSendCancellation(event.target.checked)}
              type="checkbox"
            />
            Enviar aviso de cancelación por WhatsApp
          </label>
          {sendCancellation ? (
            <label className="text-sm">
              Contacto destinatario
              <select
                className={inputClass}
                name="notificationRecipientContactId"
                required
              >
                <option value="">Seleccione un Contacto vinculado</option>
                {appointment.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} · {contact.phoneE164}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            className="w-fit rounded bg-rose-300 px-3 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={cancelling}
            type="submit"
          >
            {cancelling ? "Cancelando…" : "Cancelar Cita"}
          </button>
        </form>
      ) : null}
      {appointment.status === "confirmed" && !canCancel ? (
        <p className="text-slate-400">
          Esta Cita ya inició o pasó y no puede cancelarse.
        </p>
      ) : null}
      {cancelError ? <p className="text-rose-300">{cancelError}</p> : null}
    </aside>
  );
}

function appointmentEventLabel(type: AppointmentEventType) {
  switch (type) {
    case "manual-created":
      return "Cita manual creada";
    case "cancelled":
      return "Cita cancelada";
    case "manual-confirmation-sent":
      return "Confirmación por WhatsApp enviada";
    case "manual-confirmation-failed":
      return "No se pudo enviar la confirmación por WhatsApp";
    case "manual-cancellation-sent":
      return "Aviso de cancelación por WhatsApp enviado";
    case "manual-cancellation-failed":
      return "No se pudo enviar el aviso de cancelación por WhatsApp";
  }
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

function calendarPeriodFor(dates: string[]) {
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  if (firstDate === undefined || lastDate === undefined) {
    throw new Error("El Calendario requiere al menos un día visible");
  }
  return {
    from: clinicMidnight(firstDate),
    to: clinicMidnight(nextLocalDate(lastDate)),
  };
}

function clinicMidnight(date: string) {
  return new Date(`${date}T00:00:00${CLINIC_UTC_OFFSET}`);
}

function nextLocalDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function isCalendarBlock(
  entry: CalendarEntry | undefined,
): entry is CalendarBlock {
  return entry !== undefined && "privateLabel" in entry;
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
