"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";

export function DoctorProfileSetup({
  initialProfile,
}: {
  initialProfile: {
    primarySpecialty: string | null;
    publicName: string | null;
  };
}) {
  const [completed, setCompleted] = useState(
    initialProfile.primarySpecialty !== null &&
      initialProfile.publicName !== null,
  );
  const [result, setResult] = useState<string>();
  const completion = api.panacea.completeOwnDoctorProfile.useMutation({
    onSuccess: () => {
      setCompleted(true);
      setResult("Perfil de Médico guardado.");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const primarySpecialty = data.get("primarySpecialty");
    const publicName = data.get("publicName");
    completion.mutate({
      primarySpecialty:
        typeof primarySpecialty === "string" ? primarySpecialty : "",
      publicName: typeof publicName === "string" ? publicName : "",
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Configuración inicial</h2>
        <p className="mt-1 text-sm text-slate-300">
          Su perfil de Médico ya está vinculado a esta Clínica. Complete estos
          datos antes de configurar Servicios y Disponibilidad.
        </p>
      </div>
      <ol className="list-inside list-decimal space-y-1 text-sm text-slate-200">
        <li>
          {completed
            ? "Perfil de Médico completado"
            : "Completar su perfil de Médico"}
        </li>
        <li>Configurar el primer Servicio</li>
        <li>Definir el primer Horario vigente</li>
      </ol>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm">
          Nombre público
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            defaultValue={initialProfile.publicName ?? ""}
            maxLength={120}
            name="publicName"
            required
          />
        </label>
        <label className="block text-sm">
          Especialidad principal
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            defaultValue={initialProfile.primarySpecialty ?? ""}
            maxLength={160}
            name="primarySpecialty"
            required
          />
        </label>
        <button
          className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={completion.isPending}
          type="submit"
        >
          {completion.isPending ? "Guardando…" : "Guardar perfil"}
        </button>
      </form>
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {completion.error ? (
        <p className="text-sm text-rose-300">{completion.error.message}</p>
      ) : null}
    </section>
  );
}
