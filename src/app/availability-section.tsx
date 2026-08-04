"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";

export function AvailabilitySection({ canManageAll }: { canManageAll: boolean }) {
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
      doctorId: value(data, "doctorId"),
      effectiveFrom: value(data, "effectiveFrom"),
      periods: value(data, "periods")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [dayOfWeek, startTime, endTime] = line.split(",");
          return { dayOfWeek: Number(dayOfWeek), endTime: endTime ?? "", startTime: startTime ?? "" };
        }),
    });
  }

  function saveBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    block.mutate({
      doctorId: value(data, "doctorId"),
      endsAt: clinicDateTime(value(data, "endsAt")),
      privateLabel: value(data, "privateLabel") || undefined,
      startsAt: clinicDateTime(value(data, "startsAt")),
    });
  }

  function saveBulkBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    bulkBlock.mutate({
      doctorIds: data.getAll("doctorIds").filter((id): id is string => typeof id === "string"),
      endsAt: clinicDateTime(value(data, "endsAt")),
      privateLabel: value(data, "privateLabel") || undefined,
      startsAt: clinicDateTime(value(data, "startsAt")),
    });
  }

  const error = schedule.error ?? block.error ?? bulkBlock.error;
  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Horarios y Bloqueos</h2>
        <p className="mt-1 text-sm text-slate-300">La Clínica interpreta toda disponibilidad en America/El_Salvador.</p>
      </div>
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={saveSchedule}>
        <select className="rounded border border-slate-700 bg-slate-950 p-2" name="doctorId" required>
          {availability.data?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.publicName}</option>)}
        </select>
        <input className="rounded border border-slate-700 bg-slate-950 p-2" name="effectiveFrom" required type="date" />
        <textarea className="rounded border border-slate-700 bg-slate-950 p-2 sm:col-span-2" name="periods" placeholder="Día, inicio, fin por línea; por ejemplo: 1,08:00,12:00\n1,14:00,17:00" required />
        <button className="rounded bg-teal-300 p-2 font-medium text-slate-950" disabled={schedule.isPending} type="submit">Guardar Horario</button>
      </form>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={saveBlock}>
        <select className="rounded border border-slate-700 bg-slate-950 p-2" name="doctorId" required>{availability.data?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.publicName}</option>)}</select>
        <input className="rounded border border-slate-700 bg-slate-950 p-2" name="privateLabel" placeholder="Etiqueta privada (opcional)" />
        <input className="rounded border border-slate-700 bg-slate-950 p-2" name="startsAt" required type="datetime-local" />
        <input className="rounded border border-slate-700 bg-slate-950 p-2" name="endsAt" required type="datetime-local" />
        <button className="rounded border border-rose-300 p-2 text-rose-300" disabled={block.isPending} type="submit">Crear Bloqueo</button>
      </form>
      {canManageAll ? <form className="grid gap-2" onSubmit={saveBulkBlock}>
        <select className="rounded border border-slate-700 bg-slate-950 p-2" multiple name="doctorIds" required>{availability.data?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.publicName}</option>)}</select>
        <div className="grid gap-2 sm:grid-cols-3"><input className="rounded border border-slate-700 bg-slate-950 p-2" name="privateLabel" placeholder="Etiqueta privada" /><input className="rounded border border-slate-700 bg-slate-950 p-2" name="startsAt" required type="datetime-local" /><input className="rounded border border-slate-700 bg-slate-950 p-2" name="endsAt" required type="datetime-local" /></div>
        <button className="w-fit rounded border border-rose-300 p-2 text-rose-300" disabled={bulkBlock.isPending} type="submit">Aplicar Bloqueo masivo</button>
      </form> : null}
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {error ? <p className="text-sm text-rose-300">{error.message}</p> : null}
    </section>
  );
}

function value(data: FormData, field: string) {
  const formValue = data.get(field);
  return typeof formValue === "string" ? formValue : "";
}

/** datetime-local no lleva zona: la Clínica siempre lo interpreta como UTC-06:00. */
function clinicDateTime(value: string) {
  return new Date(`${value}:00-06:00`);
}
