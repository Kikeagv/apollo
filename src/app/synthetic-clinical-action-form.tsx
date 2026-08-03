"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

/** Acción de comprobación disponible solo dentro de una Sesión de Clínica. */
export function SyntheticClinicalActionForm() {
  const [message, setMessage] = useState<string>();
  const action = api.panacea.performSyntheticClinicalAction.useMutation({
    onError: () => setMessage("No se pudo registrar la acción clínica."),
    onSuccess: () =>
      setMessage("La acción clínica sintética quedó registrada."),
  });

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 p-4">
      <h2 className="text-lg font-medium">Comprobación clínica</h2>
      <p className="text-sm text-slate-300">
        Registre una acción sintética para comprobar el aislamiento de esta
        Clínica.
      </p>
      <button
        className="rounded-md bg-teal-400 px-4 py-2 font-medium text-slate-950 disabled:opacity-60"
        disabled={action.isPending}
        onClick={() => action.mutate()}
        type="button"
      >
        {action.isPending ? "Registrando…" : "Registrar acción sintética"}
      </button>
      {message === undefined ? null : <p role="status">{message}</p>}
    </section>
  );
}
