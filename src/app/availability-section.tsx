"use client";

import { type FormEvent, useState } from "react";

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
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "~/components/ui/native-select";
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

type PendingCapacityChange =
  | {
      kind: "schedule";
      input: {
        doctorId: string;
        effectiveFrom: string;
        periods: PeriodInput[];
      };
    }
  | {
      kind: "block";
      input: {
        doctorId: string;
        endsAt: Date;
        privateLabel?: string;
        startsAt: Date;
      };
    }
  | {
      kind: "bulk-block";
      input: {
        doctorIds: string[];
        endsAt: Date;
        privateLabel?: string;
        startsAt: Date;
      };
    };

export function AvailabilitySection({
  canManageAll,
}: {
  canManageAll: boolean;
}) {
  const [periods, setPeriods] = useState<PeriodInput[]>([emptyPeriod()]);
  const [pendingChange, setPendingChange] = useState<PendingCapacityChange>();
  const [result, setResult] = useState<string>();
  const [bulkDoctorSelectionError, setBulkDoctorSelectionError] =
    useState<string>();
  const availability = api.panacea.listAvailabilityConfiguration.useQuery();
  const schedule = api.panacea.configureEffectiveSchedule.useMutation({
    onSuccess: () => {
      setPendingChange(undefined);
      setResult("Horario vigente actualizado para opciones nuevas.");
      void availability.refetch();
    },
    onError: () => setResult(undefined),
  });
  const block = api.panacea.createAvailabilityBlock.useMutation({
    onSuccess: () => {
      setPendingChange(undefined);
      setResult("Bloqueo creado sin exponer su etiqueta a pacientes.");
      void availability.refetch();
    },
    onError: () => setResult(undefined),
  });
  const bulkBlock = api.panacea.createAvailabilityBlocks.useMutation({
    onSuccess: (blocks) => {
      setPendingChange(undefined);
      setResult(`${blocks.length} Bloqueos individuales creados.`);
      void availability.refetch();
    },
    onError: () => setResult(undefined),
  });

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPendingChange({
      kind: "schedule",
      input: {
        doctorId: formValue(data, "doctorId"),
        effectiveFrom: formValue(data, "effectiveFrom"),
        periods: [...periods],
      },
    });
  }

  function saveBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPendingChange({
      kind: "block",
      input: {
        doctorId: formValue(data, "doctorId"),
        endsAt: clinicLocalDate(formValue(data, "endsAt")),
        privateLabel: formValue(data, "privateLabel") || undefined,
        startsAt: clinicLocalDate(formValue(data, "startsAt")),
      },
    });
  }

  function saveBulkBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const doctorIds = formValues(data, "doctorIds");
    if (doctorIds.length === 0) {
      setBulkDoctorSelectionError("Selecciona al menos un Médico.");
      return;
    }
    setBulkDoctorSelectionError(undefined);
    setPendingChange({
      kind: "bulk-block",
      input: {
        doctorIds,
        endsAt: clinicLocalDate(formValue(data, "endsAt")),
        privateLabel: formValue(data, "privateLabel") || undefined,
        startsAt: clinicLocalDate(formValue(data, "startsAt")),
      },
    });
  }

  function confirmPendingChange() {
    if (pendingChange === undefined) return;
    if (pendingChange.kind === "schedule") {
      schedule.mutate(pendingChange.input);
    } else if (pendingChange.kind === "block") {
      block.mutate(pendingChange.input);
    } else {
      bulkBlock.mutate(pendingChange.input);
    }
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
  const scheduleErrorId = "availability-schedule-error";
  const blockErrorId = "availability-block-error";
  const bulkBlockErrorId = "availability-bulk-block-error";
  const scheduleFieldProps = schedule.error
    ? ({
        "aria-describedby": scheduleErrorId,
        "aria-invalid": true,
      } as const)
    : {};
  const blockFieldProps = block.error
    ? ({
        "aria-describedby": blockErrorId,
        "aria-invalid": true,
      } as const)
    : {};
  const bulkBlockFieldProps = bulkBlock.error
    ? ({
        "aria-describedby": bulkBlockErrorId,
        "aria-invalid": true,
      } as const)
    : {};
  const bulkDoctorFieldProps =
    bulkBlock.error !== undefined || bulkDoctorSelectionError !== undefined
      ? ({
          "aria-describedby": [
            bulkBlock.error ? bulkBlockErrorId : undefined,
            bulkDoctorSelectionError ? "bulk-doctors-error" : undefined,
          ]
            .filter((id): id is string => id !== undefined)
            .join(" "),
          "aria-invalid": true,
        } as const)
      : {};
  const doctorName = new Map(
    availability.data?.doctors.map((doctor) => [doctor.id, doctor.publicName]),
  );
  const configurableDoctors =
    availability.data?.doctors.filter((doctor) => doctor.active) ?? [];

  return (
    <section className="border-border bg-card text-card-foreground space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="text-xl font-semibold">Horarios y Bloqueos</h2>
        <p className="text-muted-foreground mt-1 text-sm">
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
      configurableDoctors.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          No hay Médicos con disponibilidad configurable todavía.
        </p>
      ) : null}
      <form className="space-y-2" onSubmit={saveSchedule}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">
            Médico del horario
            <NativeSelect
              {...scheduleFieldProps}
              className="mt-1 w-full"
              name="doctorId"
              required
            >
              {configurableDoctors.map((doctor) => (
                <NativeSelectOption key={doctor.id} value={doctor.id}>
                  {doctor.publicName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="block text-sm">
            Fecha de inicio del horario
            <Input
              {...scheduleFieldProps}
              className="mt-1"
              name="effectiveFrom"
              min={today()}
              required
              type="date"
            />
          </label>
        </div>
        <div className="space-y-2">
          {periods.map((period, index) => (
            <div className="grid gap-2 sm:grid-cols-4" key={index}>
              <label className="block text-sm">
                Día de franja {index + 1}
                <NativeSelect
                  {...scheduleFieldProps}
                  className="mt-1 w-full"
                  onChange={(event) =>
                    updatePeriod(index, "dayOfWeek", event.target.value)
                  }
                  value={period.dayOfWeek}
                >
                  {weekdays.map((day, dayOfWeek) => (
                    <NativeSelectOption key={day} value={dayOfWeek}>
                      {day}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="block text-sm">
                Inicio de franja {index + 1}
                <Input
                  {...scheduleFieldProps}
                  className="mt-1"
                  onChange={(event) =>
                    updatePeriod(index, "startTime", event.target.value)
                  }
                  required
                  type="time"
                  value={period.startTime}
                />
              </label>
              <label className="block text-sm">
                Fin de franja {index + 1}
                <Input
                  {...scheduleFieldProps}
                  className="mt-1"
                  onChange={(event) =>
                    updatePeriod(index, "endTime", event.target.value)
                  }
                  required
                  type="time"
                  value={period.endTime}
                />
              </label>
              <Button
                disabled={periods.length === 1}
                onClick={() =>
                  setPeriods((current) =>
                    current.filter((_, periodIndex) => periodIndex !== index),
                  )
                }
                type="button"
                variant="outline"
              >
                Quitar franja
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setPeriods((current) => [...current, emptyPeriod()])}
            type="button"
            variant="outline"
          >
            Añadir franja
          </Button>
          <Button disabled={schedule.isPending} type="submit">
            Guardar Horario
          </Button>
        </div>
        {schedule.error ? (
          <FieldError id={scheduleErrorId}>{schedule.error.message}</FieldError>
        ) : null}
      </form>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={saveBlock}>
        <label className="block text-sm">
          Médico del bloqueo
          <NativeSelect
            {...blockFieldProps}
            className="mt-1 w-full"
            name="doctorId"
            required
          >
            {configurableDoctors.map((doctor) => (
              <NativeSelectOption key={doctor.id} value={doctor.id}>
                {doctor.publicName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="block text-sm">
          Etiqueta privada del bloqueo
          <Input
            {...blockFieldProps}
            className="mt-1"
            name="privateLabel"
            placeholder="Etiqueta privada (opcional)"
          />
        </label>
        <label className="block text-sm">
          Inicio del bloqueo
          <Input
            {...blockFieldProps}
            className="mt-1"
            name="startsAt"
            required
            type="datetime-local"
          />
        </label>
        <label className="block text-sm">
          Fin del bloqueo
          <Input
            {...blockFieldProps}
            className="mt-1"
            name="endsAt"
            required
            type="datetime-local"
          />
        </label>
        <Button variant="destructive" disabled={block.isPending} type="submit">
          Revisar Bloqueo
        </Button>
        {block.error ? (
          <FieldError id={blockErrorId}>{block.error.message}</FieldError>
        ) : null}
      </form>
      {canManageAll ? (
        <form className="grid gap-2" onSubmit={saveBulkBlock}>
          <fieldset
            aria-describedby={[
              "bulk-doctors-description",
              bulkBlock.error ? bulkBlockErrorId : undefined,
              bulkDoctorSelectionError ? "bulk-doctors-error" : undefined,
            ]
              .filter((id): id is string => id !== undefined)
              .join(" ")}
            aria-invalid={
              bulkBlock.error !== undefined ||
              bulkDoctorSelectionError !== undefined
            }
            className="space-y-2"
          >
            <legend className="text-sm font-medium">
              Médicos del bloqueo masivo
            </legend>
            <p
              className="text-muted-foreground text-sm"
              id="bulk-doctors-description"
            >
              Selecciona uno o más Médicos para crear un Bloqueo individual por
              Médico.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {configurableDoctors.map((doctor) => (
                <label
                  className="border-border hover:bg-muted flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                  key={doctor.id}
                >
                  <input
                    {...bulkDoctorFieldProps}
                    className="border-border accent-primary size-5 shrink-0 rounded border"
                    name="doctorIds"
                    type="checkbox"
                    value={doctor.id}
                  />
                  <span>{doctor.publicName}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-sm">
              Etiqueta privada del bloqueo masivo
              <Input
                {...bulkBlockFieldProps}
                className="mt-1"
                name="privateLabel"
                placeholder="Etiqueta privada"
              />
            </label>
            <label className="block text-sm">
              Inicio del bloqueo masivo
              <Input
                {...bulkBlockFieldProps}
                className="mt-1"
                name="startsAt"
                required
                type="datetime-local"
              />
            </label>
            <label className="block text-sm">
              Fin del bloqueo masivo
              <Input
                {...bulkBlockFieldProps}
                className="mt-1"
                name="endsAt"
                required
                type="datetime-local"
              />
            </label>
          </div>
          <Button
            className="w-fit"
            variant="destructive"
            disabled={bulkBlock.isPending}
            type="submit"
          >
            Revisar Bloqueo masivo
          </Button>
          {bulkDoctorSelectionError ? (
            <FieldError id="bulk-doctors-error">
              {bulkDoctorSelectionError}
            </FieldError>
          ) : null}
          {bulkBlock.error ? (
            <FieldError id={bulkBlockErrorId}>
              {bulkBlock.error.message}
            </FieldError>
          ) : null}
        </form>
      ) : null}
      {availability.data?.schedules.length ? (
        <ul className="text-muted-foreground space-y-1 text-sm">
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
        <ul className="text-muted-foreground space-y-1 text-sm">
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
      {result ? <p className="text-success text-sm">{result}</p> : null}
      {error?.data?.capacityConflicts ? (
        <ul className="text-destructive space-y-1 text-sm">
          {error.data.capacityConflicts.map((conflict) => (
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
      <AlertDialog
        onOpenChange={(open) => {
          if (
            !open &&
            !schedule.isPending &&
            !block.isPending &&
            !bulkBlock.isPending
          ) {
            setPendingChange(undefined);
          }
        }}
        open={pendingChange !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {pendingChange?.kind === "schedule"
              ? "¿Confirmar cambio de Horario?"
              : pendingChange?.kind === "bulk-block"
                ? "¿Confirmar Bloqueos para el equipo?"
                : "¿Confirmar reducción de capacidad?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingChange?.kind === "schedule"
              ? "El nuevo Horario se aplicará a las Opciones futuras y conservará el historial. Si Citas o Reservas quedan fuera de la nueva capacidad, se mostrarán y el cambio completo será rechazado."
              : pendingChange?.kind === "bulk-block"
                ? "Se crearán Bloqueos individuales para todos los Médicos seleccionados. Si uno tiene una Cita o Reserva en conflicto, no se aplicará ningún Bloqueo."
                : "El Bloqueo impedirá nuevas Opciones en ese intervalo. Si existe una Cita confirmada o una Reserva activa, el cambio completo será rechazado y se mostrará el conflicto."}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                schedule.isPending || block.isPending || bulkBlock.isPending
              }
            >
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                schedule.isPending || block.isPending || bulkBlock.isPending
              }
              onClick={confirmPendingChange}
            >
              {schedule.isPending || block.isPending || bulkBlock.isPending
                ? "Guardando…"
                : "Confirmar cambio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
