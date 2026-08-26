"use client";

import { type FormEvent, useState } from "react";

import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import { api } from "~/trpc/react";
import { formValue, formValues } from "./form-values";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

const weekdays = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

type PeriodInput = {
  dayOfWeek: number;
  endTime: string;
  startTime: string;
};

const emptyPeriod = (): PeriodInput => ({
  dayOfWeek: 1,
  endTime: "",
  startTime: "",
});

export function AvailabilitySection({
  canManageAll,
}: {
  canManageAll: boolean;
}) {
  const [periods, setPeriods] = useState<PeriodInput[]>([emptyPeriod()]);
  const [result, setResult] = useState<string>();
  const availability = api.panacea.listAvailabilityConfiguration.useQuery();
  const schedule = api.panacea.configureEffectiveSchedule.useMutation({
    onSuccess: () => {
      setResult("Horario vigente actualizado para opciones nuevas.");
      void availability.refetch();
    },
  });
  const block = api.panacea.createAvailabilityBlock.useMutation({
    onSuccess: () => {
      setResult("Bloqueo creado sin exponer su etiqueta a pacientes.");
      void availability.refetch();
    },
  });
  const bulkBlock = api.panacea.createAvailabilityBlocks.useMutation({
    onSuccess: (blocks) => {
      setResult(`${blocks.length} Bloqueos individuales creados.`);
      void availability.refetch();
    },
  });

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    schedule.mutate({
      doctorId: formValue(data, "doctorId"),
      effectiveFrom: formValue(data, "effectiveFrom"),
      periods,
    });
  }

  function saveBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    block.mutate({
      doctorId: formValue(data, "doctorId"),
      endsAt: clinicLocalDate(formValue(data, "endsAt")),
      privateLabel: formValue(data, "privateLabel") || undefined,
      startsAt: clinicLocalDate(formValue(data, "startsAt")),
    });
  }

  function saveBulkBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    bulkBlock.mutate({
      doctorIds: formValues(data, "doctorIds"),
      endsAt: clinicLocalDate(formValue(data, "endsAt")),
      privateLabel: formValue(data, "privateLabel") || undefined,
      startsAt: clinicLocalDate(formValue(data, "startsAt")),
    });
  }

  function updatePeriod(
    index: number,
    field: keyof PeriodInput,
    value: string,
  ) {
    setPeriods((current) =>
      current.map((period, periodIndex) =>
        periodIndex === index
          ? {
              ...period,
              [field]: field === "dayOfWeek" ? Number(value) : value,
            }
          : period,
      ),
    );
  }

  const error = schedule.error ?? block.error ?? bulkBlock.error;
  const capacityConflicts = error?.data?.capacityConflicts;
  const doctorName = new Map(
    availability.data?.doctors.map((doctor) => [doctor.id, doctor.publicName]),
  );

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Horarios y Bloqueos</h2>
        <p className="mt-1 text-sm text-slate-300">
          La Clínica interpreta toda disponibilidad en {CLINIC_TIMEZONE}.
        </p>
      </div>
      {availability.error ? (
        <PanaceaQueryError
          error={availability.error}
          onRetry={() => void availability.refetch()}
          title="Disponibilidad"
        />
      ) : availability.isLoading ? (
        <PanaceaQueryLoading label="Cargando Disponibilidad" />
      ) : null}
      {!availability.isLoading &&
      !availability.error &&
      availability.data?.doctors.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          No hay Médicos con disponibilidad configurable todavía.
        </p>
      ) : null}
      <form className="space-y-2" onSubmit={saveSchedule}>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            aria-label="Médico del horario"
            className="rounded border border-slate-700 bg-slate-950 p-2"
            name="doctorId"
            required
          >
            {availability.data?.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.publicName}
              </option>
            ))}
          </select>
          <input
            aria-label="Fecha de inicio del horario"
            className="rounded border border-slate-700 bg-slate-950 p-2"
            name="effectiveFrom"
            required
            type="date"
          />
        </div>
        <div className="space-y-2">
          {periods.map((period, index) => (
            <div className="grid gap-2 sm:grid-cols-4" key={index}>
              <select
                aria-label={`Día de franja ${index + 1}`}
                className="rounded border border-slate-700 bg-slate-950 p-2"
                onChange={(event) =>
                  updatePeriod(index, "dayOfWeek", event.target.value)
                }
                value={period.dayOfWeek}
              >
                {weekdays.map((day, dayOfWeek) => (
                  <option key={day} value={dayOfWeek}>
                    {day}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Inicio de franja ${index + 1}`}
                className="rounded border border-slate-700 bg-slate-950 p-2"
                onChange={(event) =>
                  updatePeriod(index, "startTime", event.target.value)
                }
                required
                type="time"
                value={period.startTime}
              />
              <input
                aria-label={`Fin de franja ${index + 1}`}
                className="rounded border border-slate-700 bg-slate-950 p-2"
                onChange={(event) =>
                  updatePeriod(index, "endTime", event.target.value)
                }
                required
                type="time"
                value={period.endTime}
              />
              <button
                className="rounded border border-slate-600 p-2 disabled:opacity-50"
                disabled={periods.length === 1}
                onClick={() =>
                  setPeriods((current) =>
                    current.filter((_, periodIndex) => periodIndex !== index),
                  )
                }
                type="button"
              >
                Quitar franja
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-slate-600 p-2"
            onClick={() => setPeriods((current) => [...current, emptyPeriod()])}
            type="button"
          >
            Añadir franja
          </button>
          <button
            className="rounded bg-teal-300 p-2 font-medium text-slate-950"
            disabled={schedule.isPending}
            type="submit"
          >
            Guardar Horario
          </button>
        </div>
      </form>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={saveBlock}>
        <select
          aria-label="Médico del bloqueo"
          className="rounded border border-slate-700 bg-slate-950 p-2"
          name="doctorId"
          required
        >
          {availability.data?.doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.publicName}
            </option>
          ))}
        </select>
        <input
          aria-label="Etiqueta privada del bloqueo"
          className="rounded border border-slate-700 bg-slate-950 p-2"
          name="privateLabel"
          placeholder="Etiqueta privada (opcional)"
        />
        <input
          aria-label="Inicio del bloqueo"
          className="rounded border border-slate-700 bg-slate-950 p-2"
          name="startsAt"
          required
          type="datetime-local"
        />
        <input
          aria-label="Fin del bloqueo"
          className="rounded border border-slate-700 bg-slate-950 p-2"
          name="endsAt"
          required
          type="datetime-local"
        />
        <button
          className="rounded border border-rose-300 p-2 text-rose-300"
          disabled={block.isPending}
          type="submit"
        >
          Crear Bloqueo
        </button>
      </form>
      {canManageAll ? (
        <form className="grid gap-2" onSubmit={saveBulkBlock}>
          <select
            aria-label="Médicos del bloqueo masivo"
            className="rounded border border-slate-700 bg-slate-950 p-2"
            multiple
            name="doctorIds"
            required
          >
            {availability.data?.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.publicName}
              </option>
            ))}
          </select>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              aria-label="Etiqueta privada del bloqueo masivo"
              className="rounded border border-slate-700 bg-slate-950 p-2"
              name="privateLabel"
              placeholder="Etiqueta privada"
            />
            <input
              aria-label="Inicio del bloqueo masivo"
              className="rounded border border-slate-700 bg-slate-950 p-2"
              name="startsAt"
              required
              type="datetime-local"
            />
            <input
              aria-label="Fin del bloqueo masivo"
              className="rounded border border-slate-700 bg-slate-950 p-2"
              name="endsAt"
              required
              type="datetime-local"
            />
          </div>
          <button
            className="w-fit rounded border border-rose-300 p-2 text-rose-300"
            disabled={bulkBlock.isPending}
            type="submit"
          >
            Aplicar Bloqueo masivo
          </button>
        </form>
      ) : null}
      {availability.data?.schedules.length ? (
        <ul className="space-y-1 text-sm text-slate-300">
          {availability.data.schedules.map((schedule) => (
            <li key={schedule.id}>
              {doctorName.get(schedule.doctorId)}: {schedule.effectiveFrom} a{" "}
              {schedule.effectiveUntil ?? "vigente"} ·{" "}
              {schedule.periods
                .map(
                  (period) =>
                    `${weekdays[period.dayOfWeek]} ${period.startTime}-${period.endTime}`,
                )
                .join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      {availability.data?.blocks.length ? (
        <ul className="space-y-1 text-sm text-slate-300">
          {availability.data.blocks.map((existingBlock) => (
            <li key={existingBlock.id}>
              {doctorName.get(existingBlock.doctorId)}:{" "}
              {formatClinicDate(existingBlock.startsAt)} a{" "}
              {formatClinicDate(existingBlock.endsAt)}
              {existingBlock.privateLabel
                ? ` · ${existingBlock.privateLabel}`
                : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {error ? <p className="text-sm text-rose-300">{error.message}</p> : null}
      {capacityConflicts ? (
        <ul className="space-y-1 text-sm text-rose-300">
          {capacityConflicts.map((conflict) => (
            <li key={`${conflict.kind}-${conflict.id}`}>
              {doctorName.get(conflict.doctorId)}:{" "}
              {conflict.kind === "confirmed-appointment"
                ? "Cita confirmada"
                : "Reserva temporal activa"}{" "}
              de {formatClinicDate(conflict.startsAt)} a{" "}
              {formatClinicDate(conflict.endsAt)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function clinicLocalDate(value: string) {
  return new Date(`${value}:00${CLINIC_UTC_OFFSET}`);
}

function formatClinicDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
