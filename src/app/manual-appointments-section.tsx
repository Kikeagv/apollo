"use client";

import {
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  calendarDates,
  calendarEntryEnd,
  calendarGridBounds,
  calendarPeriodFor,
  calendarSegments,
  type CalendarEntrySegment,
  parseCalendarDate,
  type CalendarView,
} from "~/domain/panacea-calendar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogDismissButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  NativeSelect,
  NativeSelectOption,
} from "~/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type {
  AgendaAppointment,
  AppointmentEventType,
  CalendarBlock,
  CalendarEntry,
} from "~/server/application/manual-appointments";
import { api } from "~/trpc/react";
import { formValue } from "./form-values";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.toString();
  const urlCalendarDate = parseCalendarDate(searchParams.get("date"), today());
  const urlDoctorId = searchParams.get("doctor") ?? "";
  const urlSelectedId = searchParams.get("selected") ?? undefined;
  const urlView = parseCalendarView(searchParams.get("view"));
  const [calendarDate, setCalendarDate] = useState(urlCalendarDate);
  const [doctorId, setDoctorId] = useState(urlDoctorId);
  const [selectedId, setSelectedId] = useState(urlSelectedId);
  const [view, setView] = useState<CalendarView>(urlView);
  const [outsideScheduleConfirmation, setOutsideScheduleConfirmation] =
    useState<ManualAppointmentRequest>();
  const [patientId, setPatientId] = useState("");
  const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
  const [appointmentStartsAt, setAppointmentStartsAt] = useState("");
  const [serviceOfferId, setServiceOfferId] = useState("");
  const [patientRegistrationOpen, setPatientRegistrationOpen] = useState(false);
  const [recordRegistrationResult, setRecordRegistrationResult] =
    useState<string>();
  const [sendConfirmation, setSendConfirmation] = useState(false);
  useEffect(() => {
    if (urlQuery !== window.location.search.slice(1)) return;
    setCalendarDate(urlCalendarDate);
    setDoctorId(urlDoctorId);
    setSelectedId(urlSelectedId);
    setView(urlView);
  }, [urlCalendarDate, urlDoctorId, urlQuery, urlSelectedId, urlView]);
  useEffect(() => {
    function syncCalendarStateFromHistory() {
      const params = new URLSearchParams(window.location.search);
      setCalendarDate(parseCalendarDate(params.get("date"), today()));
      setDoctorId(params.get("doctor") ?? "");
      setSelectedId(params.get("selected") ?? undefined);
      setView(parseCalendarView(params.get("view")));
    }
    window.addEventListener("popstate", syncCalendarStateFromHistory);
    return () =>
      window.removeEventListener("popstate", syncCalendarStateFromHistory);
  }, []);
  const formData = api.panacea.listManualAppointmentFormData.useQuery();
  const registerAdministrativeRecords =
    api.panacea.registerAdministrativeRecordsForManualAppointment.useMutation({
      onSuccess: async ({ patient }) => {
        await formData.refetch();
        setPatientId(patient.id);
        setPatientRegistrationOpen(false);
        setRecordRegistrationResult(
          `Paciente ${patient.name} seleccionado para la nueva Cita.`,
        );
      },
    });
  const cancelledAppointments =
    api.panacea.listCancelledManualAppointments.useQuery();
  const calendarDoctors = api.panacea.listPanaceaCalendarDoctors.useQuery();
  const visibleDates = calendarDates(calendarDate, view);
  const calendarPeriod = calendarPeriodFor(calendarDate, view);
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
      setAppointmentDialogOpen(false);
      updateCalendarUrl({ selectedId: appointment.id }, "push");
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
    for (const doctor of calendarDoctors.data ?? []) {
      doctorsById.set(doctor.id, doctor);
    }
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
  }, [calendarAgenda.data, calendarDoctors.data, formData.data]);
  const calendarEntries = calendarAgenda.data ?? [];
  const selectedPatient = formData.data?.patients.find(
    (patient) => patient.id === patientId,
  );
  const queryError =
    formData.error ??
    cancelledAppointments.error ??
    calendarAgenda.error ??
    calendarDoctors.error;
  const isLoading =
    formData.isLoading ||
    cancelledAppointments.isLoading ||
    calendarAgenda.isLoading ||
    calendarDoctors.isLoading;

  function refetchCalendar() {
    void Promise.all([
      formData.refetch(),
      cancelledAppointments.refetch(),
      calendarAgenda.refetch(),
      calendarDoctors.refetch(),
    ]);
  }

  function updateCalendarUrl(
    changes: {
      date?: string;
      doctorId?: string;
      selectedId?: string | undefined;
      view?: CalendarView;
    },
    navigation: "push" | "replace" = "replace",
  ) {
    const nextDate =
      changes.date === undefined
        ? calendarDate
        : parseCalendarDate(changes.date, calendarDate);
    const nextDoctorId = changes.doctorId ?? doctorId;
    const nextView = changes.view ?? view;
    const params = new URLSearchParams(window.location.search);
    setCalendarParam(params, "date", nextDate, today());
    setCalendarParam(params, "view", nextView, "week");
    setCalendarParam(params, "doctor", nextDoctorId, "");
    if ("selectedId" in changes) {
      setCalendarParam(params, "selected", changes.selectedId ?? "", "");
    }
    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;
    const historyNavigation =
      navigation === "push" && changes.selectedId === selectedId
        ? "replace"
        : navigation;
    if (historyNavigation === "push") {
      window.history.pushState(null, "", nextUrl);
    } else {
      window.history.replaceState(null, "", nextUrl);
    }
    if (changes.date !== undefined) setCalendarDate(nextDate);
    if (changes.doctorId !== undefined) setDoctorId(nextDoctorId);
    if ("selectedId" in changes) setSelectedId(changes.selectedId);
    if (changes.view !== undefined) setView(nextView);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const offer = formData.data?.offers.find(
      (item) => item.serviceOfferId === formValue(data, "serviceOfferId"),
    );
    if (offer === undefined) return;
    setOutsideScheduleConfirmation(undefined);
    create.mutate({
      doctorId: offer.doctorId,
      notificationRecipientContactId: sendConfirmation
        ? formValue(data, "notificationRecipientContactId")
        : undefined,
      patientId,
      serviceOfferId: offer.serviceOfferId,
      startsAt: clinicDateTime(formValue(data, "startsAt")),
    });
  }

  function registerRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRecordRegistrationResult(undefined);
    registerAdministrativeRecords.mutate({
      birthDate: formValue(data, "birthDate"),
      contactName: formValue(data, "contactName"),
      patientName: formValue(data, "patientName"),
      phone: formValue(data, "phone"),
    });
  }

  function openAppointmentDialog(
    startsAt = `${calendarDate}T09:00`,
    preferredDoctorId = doctorId,
  ) {
    setAppointmentStartsAt(startsAt);
    setServiceOfferId(
      preferredDoctorId === ""
        ? ""
        : (formData.data?.offers.find(
            (offer) => offer.doctorId === preferredDoctorId,
          )?.serviceOfferId ?? ""),
    );
    setOutsideScheduleConfirmation(undefined);
    setRecordRegistrationResult(undefined);
    setPatientRegistrationOpen(false);
    setSendConfirmation(false);
    create.reset();
    registerAdministrativeRecords.reset();
    setAppointmentDialogOpen(true);
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Calendario</h2>
        <Button onClick={() => openAppointmentDialog()} size="lg" type="button">
          <Plus aria-hidden="true" />
          Nueva Cita manual
        </Button>
      </div>
      {queryError ? (
        <PanaceaQueryError
          error={queryError}
          onRetry={refetchCalendar}
          title="Calendario"
        />
      ) : isLoading ? (
        <PanaceaQueryLoading label="Cargando datos del Calendario" />
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          setAppointmentDialogOpen(open);
          if (!open) {
            setOutsideScheduleConfirmation(undefined);
            setPatientRegistrationOpen(false);
          }
        }}
        open={appointmentDialogOpen}
      >
        <DialogContent aria-describedby="new-appointment-description">
          <DialogDismissButton />
          <DialogHeader>
            <DialogTitle>Nueva Cita manual</DialogTitle>
            <DialogDescription id="new-appointment-description">
              Seleccione un Paciente, una Oferta de servicio y el inicio de la
              atención.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 space-y-4">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <label className="text-sm">
                Paciente
                <NativeSelect
                  className={inputClass}
                  disabled={formData.data?.patients.length === 0}
                  name="patientId"
                  onChange={(event) => setPatientId(event.target.value)}
                  required
                  value={patientId}
                >
                  <NativeSelectOption value="">
                    Seleccione un Paciente
                  </NativeSelectOption>
                  {formData.data?.patients.map((patient) => (
                    <NativeSelectOption key={patient.id} value={patient.id}>
                      {patient.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="text-sm">
                Oferta de servicio
                <NativeSelect
                  className={inputClass}
                  disabled={formData.data?.offers.length === 0}
                  name="serviceOfferId"
                  onChange={(event) => setServiceOfferId(event.target.value)}
                  required
                  value={serviceOfferId}
                >
                  <NativeSelectOption value="">
                    Seleccione una Oferta
                  </NativeSelectOption>
                  {formData.data?.offers.map((offer) => (
                    <NativeSelectOption
                      key={offer.serviceOfferId}
                      value={offer.serviceOfferId}
                    >
                      {offer.doctorName} · {offer.serviceName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="text-sm">
                Inicio
                <input
                  className={inputClass}
                  name="startsAt"
                  onChange={(event) =>
                    setAppointmentStartsAt(event.target.value)
                  }
                  required
                  type="datetime-local"
                  value={appointmentStartsAt}
                />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  checked={sendConfirmation}
                  onChange={(event) =>
                    setSendConfirmation(event.target.checked)
                  }
                  type="checkbox"
                />
                Enviar confirmación inmediata por WhatsApp
              </label>
              {sendConfirmation ? (
                <label className="text-sm sm:col-span-2">
                  Contacto destinatario
                  <NativeSelect
                    className={inputClass}
                    disabled={selectedPatient === undefined}
                    name="notificationRecipientContactId"
                    required
                  >
                    <NativeSelectOption value="">
                      Seleccione un Contacto vinculado
                    </NativeSelectOption>
                    {selectedPatient?.contacts.map((contact) => (
                      <NativeSelectOption key={contact.id} value={contact.id}>
                        {contact.name} · {contact.phoneE164}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
              <Button
                className="sm:col-span-2 sm:w-fit"
                disabled={
                  create.isPending ||
                  registerAdministrativeRecords.isPending ||
                  formData.data?.patients.length === 0 ||
                  formData.data?.offers.length === 0
                }
                type="submit"
              >
                {create.isPending ? "Validando…" : "Crear Cita manual"}
              </Button>
            </form>
            <div className="border-border rounded-lg border p-3">
              <button
                className={secondaryButtonClass}
                onClick={() => setPatientRegistrationOpen((open) => !open)}
                type="button"
              >
                {patientRegistrationOpen
                  ? "Cerrar registro de Paciente"
                  : "Registrar Paciente nuevo"}
              </button>
              {patientRegistrationOpen ? (
                <form
                  className="mt-3 grid gap-4 sm:grid-cols-2"
                  onSubmit={registerRecords}
                >
                  <label className="text-sm">
                    Nombre del Contacto
                    <input className={inputClass} name="contactName" required />
                  </label>
                  <label className="text-sm">
                    Teléfono E.164 del Contacto
                    <input
                      className={inputClass}
                      name="phone"
                      placeholder="+50371234567"
                      required
                      type="tel"
                    />
                  </label>
                  <label className="text-sm">
                    Nombre del Paciente
                    <input className={inputClass} name="patientName" required />
                  </label>
                  <label className="text-sm">
                    Fecha de nacimiento del Paciente
                    <input
                      className={inputClass}
                      name="birthDate"
                      required
                      type="date"
                    />
                  </label>
                  <Button
                    className="sm:col-span-2 sm:w-fit"
                    disabled={registerAdministrativeRecords.isPending}
                    type="submit"
                  >
                    {registerAdministrativeRecords.isPending
                      ? "Registrando…"
                      : "Registrar Contacto y Paciente"}
                  </Button>
                </form>
              ) : null}
            </div>
            {recordRegistrationResult ? (
              <p
                aria-live="polite"
                className="text-primary text-sm"
                role="status"
              >
                {recordRegistrationResult}
              </p>
            ) : null}
            {formData.data?.patients.length === 0 ? (
              <p className="text-sm text-amber-800">
                Registre y vincule al menos un Contacto antes de crear la Cita.
              </p>
            ) : null}
            {create.error || registerAdministrativeRecords.error ? (
              <p className="text-destructive text-sm" role="alert">
                {(create.error ?? registerAdministrativeRecords.error)?.message}
              </p>
            ) : null}
            {outsideScheduleConfirmation ? (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  La Cita no cabe por completo en el Horario vigente. Confirme
                  la excepción para crearla sin modificar los demás controles de
                  capacidad.
                </p>
                <Button
                  disabled={create.isPending}
                  onClick={() =>
                    create.mutate({
                      ...outsideScheduleConfirmation,
                      outsideScheduleConfirmed: true,
                    })
                  }
                  type="button"
                  variant="outline"
                >
                  Confirmar Cita fuera de horario
                </Button>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose type="button">Cancelar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <section aria-labelledby="agenda-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold" id="agenda-heading">
            Agenda de la Clínica
          </h3>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => updateCalendarUrl({ date: today() })}
              size="sm"
              type="button"
              variant="outline"
            >
              Hoy
            </Button>
            <div className="border-border flex items-center gap-1 rounded-lg border p-1">
              <Button
                aria-label="Ir al período anterior"
                onClick={() =>
                  updateCalendarUrl({
                    date: shiftCalendarDate(calendarDate, view, -1),
                  })
                }
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span
                aria-label={`Período ${formatCalendarRange(visibleDates)}`}
                className="min-w-44 px-2 text-center text-sm font-semibold capitalize"
              >
                {formatCalendarTitle(visibleDates)}
              </span>
              <Button
                aria-label="Ir al período siguiente"
                onClick={() =>
                  updateCalendarUrl({
                    date: shiftCalendarDate(calendarDate, view, 1),
                  })
                }
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm font-medium" htmlFor="calendar-date">
            Ir a fecha
            <input
              aria-label="Ir a fecha"
              className={toolbarInputClass}
              id="calendar-date"
              onChange={(event) =>
                updateCalendarUrl({ date: event.target.value })
              }
              type="date"
              value={calendarDate}
            />
          </label>
          <div className="space-y-1 text-sm font-medium">
            <span className="block" id="calendar-doctor-label">
              Médico
            </span>
            <NativeSelect
              aria-labelledby="calendar-doctor-label"
              className={toolbarSelectClass}
              onChange={(event) =>
                updateCalendarUrl({ doctorId: event.target.value })
              }
              value={doctorId}
            >
              <NativeSelectOption value="">
                Todos los Médicos
              </NativeSelectOption>
              {doctors.map((doctor) => (
                <NativeSelectOption key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div
            aria-label="Vista del Calendario"
            className="border-border flex rounded-lg border p-1"
            role="group"
          >
            {(["week", "day"] as const).map((option) => (
              <button
                aria-pressed={view === option}
                className={view === option ? activeTabClass : inactiveTabClass}
                key={option}
                onClick={() => updateCalendarUrl({ view: option })}
                type="button"
              >
                {option === "week" ? "Semana" : "Día"}
              </button>
            ))}
          </div>
        </div>

        {!isLoading && !queryError ? (
          <div
            className={
              selected === undefined
                ? ""
                : "lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4"
            }
          >
            <div className="min-w-0 space-y-4">
              <CalendarTimeline
                dates={visibleDates}
                entries={calendarEntries}
                onCreate={(startsAt) => openAppointmentDialog(startsAt)}
                onSelect={(id) => updateCalendarUrl({ selectedId: id }, "push")}
                showDoctor={doctorId === ""}
              />
              {calendarEntries.length > 0 ? (
                <details className="border-border rounded-xl border">
                  <summary className="focus-visible:ring-ring/30 cursor-pointer rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3">
                    Ver agenda como lista
                  </summary>
                  <CalendarAccessibleList
                    entries={calendarEntries}
                    onSelect={(id) =>
                      updateCalendarUrl({ selectedId: id }, "push")
                    }
                    showDoctor={doctorId === ""}
                  />
                </details>
              ) : (
                <p className="sr-only">
                  No hay Citas activas ni Bloqueos en este período.
                </p>
              )}
              <CancelledAppointmentsList
                appointments={cancelledAppointments.data ?? []}
                onSelect={(id) => updateCalendarUrl({ selectedId: id }, "push")}
              />
            </div>
            <CalendarSelection
              appointment={isCalendarBlock(selected) ? undefined : selected}
              block={isCalendarBlock(selected) ? selected : undefined}
              cancelError={cancel.error?.message}
              cancelling={cancel.isPending}
              onClose={() => updateCalendarUrl({ selectedId: undefined })}
              onCancel={(input) => {
                if (selected !== undefined && !isCalendarBlock(selected)) {
                  cancel.mutate({ appointmentId: selected.id, ...input });
                }
              }}
            />
          </div>
        ) : null}
      </section>
    </section>
  );
}

function CalendarTimeline({
  dates,
  entries,
  onCreate,
  onSelect,
  showDoctor,
}: {
  dates: readonly string[];
  entries: readonly CalendarEntry[];
  onCreate: (startsAt: string) => void;
  onSelect: (id: string) => void;
  showDoctor: boolean;
}) {
  const bounds = calendarGridBounds(entries);
  const segments = calendarSegments(entries, dates, bounds);
  const hours = timelineHours(bounds);
  const currentDate = today();
  const gridHeight = Math.max(
    720,
    ((bounds.endMinute - bounds.startMinute) / 60) * 72,
  );
  const columns = `repeat(${dates.length}, minmax(${dates.length === 1 ? "16rem" : "9rem"}, 1fr))`;
  const nowIndicator = calendarNowIndicator(currentDate, dates, bounds);

  return (
    <Card
      className="border-border overflow-hidden rounded-2xl"
      data-calendar-list="true"
      data-calendar-view={dates.length === 1 ? "day" : "week"}
      size="sm"
    >
      <CardContent className="p-0">
        <div
          className="max-h-[calc(100dvh-18rem)] min-h-[30rem] overflow-auto"
          tabIndex={-1}
        >
          <div
            className="min-w-[44rem]"
            style={{ minWidth: dates.length === 1 ? "44rem" : undefined }}
          >
            <div
              className="bg-card sticky top-0 z-10 grid border-b"
              style={{ gridTemplateColumns: `4.5rem ${columns}` }}
            >
              <div className="border-border bg-muted/20 border-r" />
              {dates.map((date) => (
                <div
                  className={`border-border flex min-h-20 flex-col items-center justify-center gap-1 border-l px-3 py-2 text-center ${date === currentDate ? "bg-primary/5" : ""}`}
                  data-calendar-day="true"
                  key={date}
                >
                  <span className="text-muted-foreground text-[0.68rem] font-semibold tracking-[0.14em] uppercase">
                    {formatWeekday(date)}
                  </span>
                  <span
                    className={`flex size-10 items-center justify-center rounded-full text-xl font-semibold tabular-nums ${date === currentDate ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    {formatDayNumber(date)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatMonthShort(date)}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: `4.5rem minmax(0, 1fr)` }}
            >
              <div
                className="bg-muted/20 text-muted-foreground relative border-r text-[0.7rem] tabular-nums"
                style={{ height: gridHeight }}
              >
                {hours.map((minute) => (
                  <span
                    className="absolute right-2 -translate-y-1/2"
                    key={minute}
                    style={{
                      top: `${((minute - bounds.startMinute) / (bounds.endMinute - bounds.startMinute)) * 100}%`,
                    }}
                  >
                    {formatGridTime(minute)}
                  </span>
                ))}
              </div>
              <div
                className="bg-background relative"
                style={{ height: gridHeight }}
              >
                <div
                  className="pointer-events-none absolute inset-0 grid"
                  style={{ gridTemplateColumns: columns }}
                >
                  {dates.map((date) => (
                    <div className="border-l" key={date} />
                  ))}
                </div>
                {hours.map((minute) => (
                  <div
                    aria-hidden="true"
                    className="border-border/70 pointer-events-none absolute inset-x-0 border-t"
                    data-calendar-grid-hour="true"
                    key={minute}
                    style={{
                      top: `${((minute - bounds.startMinute) / (bounds.endMinute - bounds.startMinute)) * 100}%`,
                    }}
                  />
                ))}
                {hours.slice(0, -1).map((minute) => (
                  <div
                    aria-hidden="true"
                    className="border-border/40 pointer-events-none absolute inset-x-0 border-t border-dashed"
                    key={`half-${minute}`}
                    style={{
                      top: `${((minute + 30 - bounds.startMinute) / (bounds.endMinute - bounds.startMinute)) * 100}%`,
                    }}
                  />
                ))}
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: columns }}
                >
                  {dates.map((date) => (
                    <div className="relative" key={date}>
                      <button
                        aria-label={`Crear Cita en ${formatCalendarDate(date)} desde la cuadrícula temporal`}
                        className="focus-visible:ring-ring/40 hover:bg-primary/5 focus-visible:bg-primary/10 absolute inset-0 z-0 w-full cursor-crosshair appearance-none rounded-none border-0 bg-transparent p-0 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-inset"
                        onClick={(event) =>
                          onCreate(
                            `${date}T${formatInputTime(
                              calendarMinutesFromPointer(event, bounds),
                            )}`,
                          )
                        }
                        type="button"
                      />
                      {segments
                        .filter((segment) => segment.date === date)
                        .map((segment) => (
                          <CalendarEntryCard
                            key={`${segment.entry.id}-${segment.date}`}
                            onSelect={onSelect}
                            segment={segment}
                            showDoctor={showDoctor}
                          />
                        ))}
                    </div>
                  ))}
                </div>
                {nowIndicator ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute z-10 flex items-center"
                    data-calendar-now-indicator="true"
                    style={{
                      left: `${nowIndicator.columnIndex * (100 / dates.length)}%`,
                      top: `${nowIndicator.topPercent}%`,
                      width: `${100 / dates.length}%`,
                    }}
                  >
                    <span className="bg-destructive size-2.5 -translate-x-1/2 rounded-full" />
                    <span className="bg-destructive h-0.5 flex-1" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarEntryCard({
  onSelect,
  segment,
  showDoctor,
}: {
  onSelect: (id: string) => void;
  segment: CalendarEntrySegment<CalendarEntry>;
  showDoctor: boolean;
}) {
  const entry = segment.entry;
  const block = isCalendarBlock(entry);
  const title = block
    ? `Bloqueo${entry.privateLabel ? `: ${entry.privateLabel}` : ""}`
    : `Cita de ${entry.patient.name}: ${entry.service.name}`;
  const period = `${formatTime(entry.startsAt)} a ${formatTime(calendarEntryEnd(entry))}`;
  const description = [
    period,
    title,
    showDoctor ? entry.doctor.name : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      aria-label={description}
      className={`focus-visible:ring-ring/40 absolute z-10 min-h-11 overflow-hidden rounded-lg border p-2 text-left text-xs shadow-sm transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-3 ${
        block
          ? "border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-500"
          : "border-primary/30 bg-primary/10 text-foreground hover:border-primary"
      }`}
      onClick={() => onSelect(entry.id)}
      style={{
        height: `${Math.max(segment.heightPercent, 4)}%`,
        left: `calc(${(segment.lane / segment.laneCount) * 100}% + 0.25rem)`,
        top: `${segment.topPercent}%`,
        width: `calc(${100 / segment.laneCount}% - 0.5rem)`,
      }}
      type="button"
    >
      <span className="block truncate font-semibold">{title}</span>
      <span className="text-muted-foreground block truncate tabular-nums">
        {period}
      </span>
      {showDoctor ? (
        <span className="text-muted-foreground block truncate">
          {entry.doctor.name}
        </span>
      ) : null}
      {!block && entry.outsideSchedule ? (
        <span className="block truncate font-medium text-amber-800">
          Fuera de horario
        </span>
      ) : null}
    </button>
  );
}

function CalendarAccessibleList({
  entries,
  onSelect,
  showDoctor,
}: {
  entries: readonly CalendarEntry[];
  onSelect: (id: string) => void;
  showDoctor: boolean;
}) {
  return (
    <Card data-calendar-list="true" size="sm">
      <CardHeader className="border-b py-4">
        <CardTitle>Lista accesible de la Agenda</CardTitle>
        <CardDescription>
          La misma información está disponible como lista semántica para teclado
          y tecnologías asistivas.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ol aria-label="Citas y Bloqueos del período" className="divide-y">
          {entries.map((entry) => {
            const block = isCalendarBlock(entry);
            const title = block
              ? `Bloqueo${entry.privateLabel ? `: ${entry.privateLabel}` : ""}`
              : `${entry.patient.name} · ${entry.service.name}`;
            return (
              <li key={`${block ? "block" : "appointment"}-${entry.id}`}>
                <button
                  aria-label={`${formatClinicDate(entry.startsAt)} a ${formatTime(calendarEntryEnd(entry))} · ${title}${showDoctor ? ` · ${entry.doctor.name}` : ""}`}
                  className="hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-ring/40 flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-[background-color] outline-none focus-visible:ring-3"
                  onClick={() => onSelect(entry.id)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {showDoctor ? `${entry.doctor.name} · ` : ""}
                      {block ? "Bloqueo" : "Cita"}
                    </span>
                    {!block && entry.outsideSchedule ? (
                      <span className="block truncate text-xs font-medium text-amber-800">
                        Fuera de horario
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-right text-xs tabular-nums">
                    <span className="block">
                      {formatClinicDate(entry.startsAt)}
                    </span>
                    <span className="block">
                      hasta {formatTime(calendarEntryEnd(entry))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function CancelledAppointmentsList({
  appointments,
  onSelect,
}: {
  appointments: readonly CalendarAppointment[];
  onSelect: (id: string) => void;
}) {
  if (appointments.length === 0) return null;

  return (
    <section
      aria-labelledby="cancelled-appointments-heading"
      className="border-border bg-card overflow-hidden rounded-xl border shadow-sm"
    >
      <div className="border-border border-b px-4 py-4">
        <h4
          className="text-base font-medium"
          id="cancelled-appointments-heading"
        >
          Citas canceladas
        </h4>
        <p className="text-muted-foreground mt-1 text-sm">
          No ocupan la cuadrícula, pero conservan su ficha y sus Eventos.
        </p>
      </div>
      <ul className="divide-y" aria-label="Citas canceladas">
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            <button
              className="hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-ring/40 flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-[background-color] outline-none focus-visible:ring-3"
              onClick={() => onSelect(appointment.id)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {appointment.patient.name} · {appointment.service.name}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {appointment.doctor.name} · Cancelada
                </span>
              </span>
              <span className="text-muted-foreground shrink-0 text-right text-xs tabular-nums">
                {formatClinicDate(appointment.startsAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CalendarSelection({
  appointment,
  block,
  cancelError,
  cancelling,
  onCancel,
  onClose,
}: {
  appointment: CalendarAppointment | undefined;
  block: CalendarBlock | undefined;
  cancelError: string | undefined;
  cancelling: boolean;
  onCancel: (input: {
    notificationRecipientContactId?: string;
    reason?: string;
  }) => void;
  onClose: () => void;
}) {
  const selected = appointment ?? block;
  const isMobile = useIsMobile();
  if (selected === undefined) return null;

  const detail = block ? (
    <AvailabilityBlockDetail block={block} />
  ) : (
    <AppointmentDetail
      appointment={appointment}
      cancelError={cancelError}
      cancelling={cancelling}
      onCancel={onCancel}
    />
  );
  return (
    <>
      <div className="hidden lg:block">
        <div className="border-border bg-card rounded-xl border p-1 shadow-sm">
          {detail}
          <div className="border-border mt-4 border-t px-4 py-3">
            <Button onClick={onClose} type="button" variant="ghost">
              Cerrar detalle
            </Button>
          </div>
        </div>
      </div>
      <Sheet
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        open={isMobile && selected !== undefined}
      >
        <SheetContent
          className="w-[min(100vw,32rem)] overflow-y-auto p-0"
          side="right"
        >
          <SheetHeader className="border-b">
            <SheetTitle>
              {block ? "Detalle del Bloqueo" : "Detalle de la Cita"}
            </SheetTitle>
            <SheetDescription>
              Revise la información sin abandonar el contexto del Calendario.
            </SheetDescription>
          </SheetHeader>
          {selected ? <div className="p-4">{detail}</div> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function AvailabilityBlockDetail({ block }: { block: CalendarBlock }) {
  return (
    <aside aria-label="Detalle del Bloqueo" className="space-y-4 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Detalle del Bloqueo</h3>
        <Badge variant="warning">Bloqueo</Badge>
      </div>
      <dl className="space-y-1">
        <Detail label="Médico" value={block.doctor.name} />
        <Detail
          label="Horario"
          value={`${formatClinicDate(block.startsAt)} a ${formatTime(block.endsAt)}`}
        />
        <Detail
          label="Etiqueta privada"
          value={block.privateLabel ?? "Sin etiqueta"}
        />
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
  const [pendingCancellation, setPendingCancellation] = useState<{
    notificationRecipientContactId?: string;
    reason?: string;
  }>();
  const [sendCancellation, setSendCancellation] = useState(false);
  if (appointment === undefined) {
    return (
      <aside className="border-border text-muted-foreground rounded border p-3 text-sm">
        Seleccione una Cita para ver su detalle.
      </aside>
    );
  }
  function requestCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPendingCancellation({
      notificationRecipientContactId: sendCancellation
        ? formValue(data, "notificationRecipientContactId")
        : undefined,
      reason: formValue(data, "reason") || undefined,
    });
  }
  const canCancel =
    appointment.origin === "manual" &&
    appointment.status === "confirmed" &&
    appointment.startsAt > new Date();
  return (
    <aside className="border-border bg-card space-y-4 rounded border p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Detalle de la Cita</h3>
        <Badge
          variant={appointment.status === "cancelled" ? "warning" : "default"}
        >
          {appointment.status === "cancelled" ? "Cancelada" : "Confirmada"}
        </Badge>
      </div>
      <dl className="space-y-1">
        <Detail label="Paciente" value={appointment.patient.name} />
        <div>
          <dt className="text-muted-foreground">Fichas relacionadas</dt>
          <dd className="flex flex-wrap gap-2">
            <a
              className="text-primary underline-offset-2 hover:underline"
              href={`/pacientes#patient-${appointment.patient.id}`}
            >
              Abrir ficha del Paciente
            </a>
            {appointment.contacts.map((contact) => (
              <a
                className="text-primary underline-offset-2 hover:underline"
                href={`/pacientes#contact-${contact.id}`}
                key={contact.id}
              >
                Abrir ficha del Contacto
              </a>
            ))}
          </dd>
        </div>
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
        <Detail
          label="Período ocupado"
          value={`${formatClinicDate(appointment.startsAt)} a ${formatTime(calendarEntryEnd(appointment))}`}
        />
        <Detail
          label="Precio cotizado"
          value={
            appointment.priceUsd === null
              ? "Sin precio cotizado"
              : `US$ ${appointment.priceUsd}`
          }
        />
        <Detail
          label="Duración cotizada"
          value={formatMinutes(appointment.durationMinutes)}
        />
        <Detail
          label="Buffer cotizado"
          value={formatMinutes(appointment.bufferMinutes)}
        />
        {appointment.outsideSchedule ? (
          <Detail label="Capacidad" value="Cita fuera de horario" />
        ) : null}
      </dl>
      <div>
        <h4 className="font-medium">Eventos de Cita</h4>
        <ul className="text-muted-foreground mt-1 space-y-1">
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
        <form className="grid gap-2" onSubmit={requestCancellation}>
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
              <NativeSelect
                className={inputClass}
                name="notificationRecipientContactId"
                required
              >
                <NativeSelectOption value="">
                  Seleccione un Contacto vinculado
                </NativeSelectOption>
                {appointment.contacts.map((contact) => (
                  <NativeSelectOption key={contact.id} value={contact.id}>
                    {contact.name} · {contact.phoneE164}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <Button
            className="w-fit"
            disabled={cancelling}
            size="lg"
            type="submit"
            variant="destructive"
          >
            Cancelar Cita
          </Button>
        </form>
      ) : null}
      {appointment.status === "confirmed" && !canCancel ? (
        <p className="text-muted-foreground">
          Esta Cita ya inició o pasó y no puede cancelarse.
        </p>
      ) : null}
      {cancelError ? (
        <p className="text-destructive" role="alert">
          {cancelError}
        </p>
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPendingCancellation(undefined);
        }}
        open={pendingCancellation !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogTitle>¿Cancelar esta Cita?</AlertDialogTitle>
          <AlertDialogDescription>
            Se cancelará la Cita de {appointment.patient.name} para{" "}
            {appointment.service.name}. Dejará de ocupar la Agenda, pero su
            ficha y sus Eventos se conservarán para consulta.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={() => {
                if (pendingCancellation === undefined) return;
                const input = pendingCancellation;
                setPendingCancellation(undefined);
                onCancel(input);
              }}
            >
              {cancelling ? "Cancelando…" : "Confirmar cancelación"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function appointmentEventLabel(type: AppointmentEventType) {
  switch (type) {
    case "manual-created":
      return "Cita manual creada";
    case "cancelled":
      return "Cita cancelada";
    case "reservation-confirmed":
      return "Reserva confirmada";
    case "rescheduled":
      return "Cita reprogramada automáticamente";
    case "self-management-escalated":
      return "Solicitud de autogestión escalada a una persona";
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
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value || "Sin Contacto vinculado"}</dd>
    </div>
  );
}

function parseCalendarView(value: string | null): CalendarView {
  return value === "day" ? "day" : "week";
}

function setCalendarParam(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
  defaultValue: string,
) {
  if (value === undefined || value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

function shiftCalendarDate(date: string, view: CalendarView, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount * (view === "week" ? 7 : 1));
  return value.toISOString().slice(0, 10);
}

function formatCalendarRange(dates: readonly string[]) {
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  if (firstDate === undefined || lastDate === undefined) return "Sin fechas";
  if (firstDate === lastDate) return formatCalendarDate(firstDate);
  return `${formatCalendarDate(firstDate)} — ${formatCalendarDate(lastDate)}`;
}

function formatCalendarTitle(dates: readonly string[]) {
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  if (firstDate === undefined || lastDate === undefined) return "Sin fechas";

  const format = (value: string) =>
    new Intl.DateTimeFormat("es-SV", {
      month: "long",
      year: "numeric",
      timeZone: CLINIC_TIMEZONE,
    }).format(new Date(`${value}T12:00:00${CLINIC_UTC_OFFSET}`));
  const firstLabel = format(firstDate);
  const lastLabel = format(lastDate);
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} — ${lastLabel}`;
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(`${value}T12:00:00${CLINIC_UTC_OFFSET}`));
}

function timelineHours(bounds: { endMinute: number; startMinute: number }) {
  return Array.from(
    { length: Math.floor((bounds.endMinute - bounds.startMinute) / 60) + 1 },
    (_, index) => bounds.startMinute + index * 60,
  );
}

function formatGridTime(minute: number) {
  const hour = Math.floor(minute / 60) % 24;
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 || 12;
  return minute % 60 === 0
    ? `${twelveHour} ${period}`
    : `${twelveHour}:${String(minute % 60).padStart(2, "0")} ${period}`;
}

function formatInputTime(minute: number) {
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function calendarMinutesFromPointer(
  event: MouseEvent<HTMLButtonElement>,
  bounds: { endMinute: number; startMinute: number },
) {
  const defaultMinute = 9 * 60;
  if (event.detail === 0) {
    return Math.min(
      bounds.endMinute - 5,
      Math.max(bounds.startMinute, defaultMinute),
    );
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = Math.max(
    0,
    Math.min(1, (event.clientY - rect.top) / rect.height),
  );
  const rawMinute =
    bounds.startMinute + ratio * (bounds.endMinute - bounds.startMinute);
  return Math.min(
    bounds.endMinute - 5,
    Math.max(bounds.startMinute, Math.round(rawMinute / 5) * 5),
  );
}

function formatWeekday(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
  }).format(new Date(`${value}T12:00:00${CLINIC_UTC_OFFSET}`));
}

function formatDayNumber(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    day: "numeric",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(`${value}T12:00:00${CLINIC_UTC_OFFSET}`));
}

function formatMonthShort(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    month: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(`${value}T12:00:00${CLINIC_UTC_OFFSET}`));
}

function calendarNowIndicator(
  currentDate: string,
  dates: readonly string[],
  bounds: { endMinute: number; startMinute: number },
) {
  if (!dates.includes(currentDate)) return undefined;
  const currentMinute = localClockMinutes(new Date());
  if (currentMinute < bounds.startMinute || currentMinute > bounds.endMinute) {
    return undefined;
  }
  return {
    columnIndex: dates.indexOf(currentDate),
    topPercent:
      ((currentMinute - bounds.startMinute) /
        (bounds.endMinute - bounds.startMinute)) *
      100,
  };
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

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}

function formatMinutes(value: number | null) {
  if (value === null) return "Sin dato";
  return `${value} min`;
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

function localClockMinutes(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hour * 60 + minute;
}

function today() {
  return localDate(new Date());
}

const inputClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/30 mt-1 min-h-10 w-full rounded border px-3 py-2 outline-none focus-visible:ring-3";
const toolbarInputClass =
  "border-input bg-background text-foreground focus-visible:ring-ring/30 mt-1 min-h-10 w-40 rounded-lg border px-3 py-2 outline-none focus-visible:ring-3";
const toolbarSelectClass = "mt-1 min-w-52";
const secondaryButtonClass =
  "border-border hover:bg-muted focus-visible:ring-ring/30 min-h-11 rounded border px-3 py-2 text-sm outline-none focus-visible:ring-3";
const activeTabClass =
  "focus-visible:ring-ring/30 focus-visible:ring-3 focus-visible:outline-none min-h-11 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground";
const inactiveTabClass =
  "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/30 focus-visible:ring-3 focus-visible:outline-none min-h-11 rounded-md px-3 py-2 text-sm font-medium";
