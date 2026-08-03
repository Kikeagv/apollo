"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";

export function SyntheticClinicRegistrationForm() {
  const [result, setResult] = useState<string>();
  const registration = api.panacea.createSyntheticClinic.useMutation({
    onSuccess: (clinic) => {
      setResult(`Clínica ${clinic.name} creada e invitación iniciada.`);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const clinicName = data.get("clinicName");
    const ownerEmail = data.get("ownerEmail");
    const ownerName = data.get("ownerName");
    registration.mutate({
      clinicName: typeof clinicName === "string" ? clinicName : "",
      ownerEmail: typeof ownerEmail === "string" ? ownerEmail : "",
      ownerName: typeof ownerName === "string" ? ownerName : "",
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="text-xl font-semibold">Crear Clínica sintética</h2>
      <p className="text-sm text-slate-300">
        Este recorrido está reservado para superadmins autenticados de Apolo.
      </p>
      <label className="block text-sm">
        Clínica
        <input
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          name="clinicName"
          required
        />
      </label>
      <label className="block text-sm">
        Médico propietario
        <input
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          name="ownerName"
          required
        />
      </label>
      <label className="block text-sm">
        Correo del médico propietario
        <input
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          name="ownerEmail"
          required
          type="email"
        />
      </label>
      <button
        className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={registration.isPending}
        type="submit"
      >
        {registration.isPending ? "Creando…" : "Crear e invitar"}
      </button>
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {registration.error ? (
        <p className="text-sm text-rose-300">{registration.error.message}</p>
      ) : null}
    </form>
  );
}
