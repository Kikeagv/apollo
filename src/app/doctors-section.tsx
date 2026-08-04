"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";
import { CapacityConflicts } from "./capacity-conflicts";

export function DoctorsSection() {
  const [result, setResult] = useState<string>();
  const invitations = api.panacea.listDoctorInvitations.useQuery();
  const doctors = api.panacea.listDoctors.useQuery();
  const invite = api.panacea.inviteAdditionalDoctor.useMutation({
    onSuccess: (invitation) => {
      setResult(`Invitación enviada a ${invitation.recipientName}.`);
      void invitations.refetch();
    },
  });
  const deactivate = api.panacea.deactivateDoctor.useMutation({
    onSuccess: (doctor) => {
      setResult(
        `Médico desactivado: ${doctor.publicName ?? "sin nombre público"}.`,
      );
      void doctors.refetch();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = data.get("email");
    const name = data.get("name");
    invite.mutate({
      email: typeof email === "string" ? email : "",
      name: typeof name === "string" ? name : "",
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Médicos</h2>
        <p className="mt-1 text-sm text-slate-300">
          Invite Médicos para que completen su perfil antes de atender Citas.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <label className="block text-sm">
          Nombre
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            maxLength={120}
            name="name"
            required
          />
        </label>
        <label className="block text-sm">
          Correo
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            name="email"
            required
            type="email"
          />
        </label>
        <button
          className="w-fit rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={invite.isPending}
          type="submit"
        >
          {invite.isPending ? "Enviando…" : "Invitar Médico"}
        </button>
      </form>
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {invite.error ? (
        <p className="text-sm text-rose-300">{invite.error.message}</p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {doctors.data?.map((doctor) => (
          <li
            className="flex items-center justify-between gap-3"
            key={doctor.id}
          >
            <span>
              {doctor.publicName ?? "Médico sin nombre público"}
              {doctor.primarySpecialty ? ` · ${doctor.primarySpecialty}` : ""}
            </span>
            <span
              className={doctor.active ? "text-teal-300" : "text-slate-400"}
            >
              {doctor.active ? "Activo" : "Desactivado"}
            </span>
            <button
              className="rounded border border-rose-300 px-3 py-1 text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!doctor.active || deactivate.isPending}
              onClick={() => deactivate.mutate({ doctorId: doctor.id })}
              type="button"
            >
              Desactivar
            </button>
          </li>
        ))}
      </ul>
      {deactivate.error ? (
        <div className="space-y-2 text-sm text-rose-300">
          <p>{deactivate.error.message}</p>
          <CapacityConflicts
            conflicts={deactivate.error.data?.capacityConflicts}
          />
        </div>
      ) : null}
      <ul className="space-y-2 text-sm">
        {invitations.data?.map((invitation) => (
          <li className="flex justify-between gap-3" key={invitation.id}>
            <span>{invitation.recipientName}</span>
            <span className="text-slate-300">
              {invitation.status === "pending"
                ? "Pendiente"
                : invitation.status === "accepted"
                  ? "Aceptada"
                  : "Vencida"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
