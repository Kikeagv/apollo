"use client";

import { api } from "~/trpc/react";

/** Control de Panacea para la Política de inasistencia por silencio. */
export function NoShowPolicySection() {
  const policy = api.panacea.getNoShowPolicy.useQuery();
  const update = api.panacea.setNoShowPolicy.useMutation({
    onSuccess: () => policy.refetch(),
  });
  return (
    <section className="space-y-3 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Inasistencia por silencio</h2>
        <p className="mt-1 text-sm text-slate-300">
          Tras el recordatorio de 20 horas, conserve la Cita o cancélela
          automáticamente si el Contacto no respondió.
        </p>
      </div>
      <fieldset className="space-y-2 text-sm">
        <label className="block">
          <input
            checked={policy.data === "alert"}
            disabled={update.isPending}
            name="no-show-policy"
            onChange={() => update.mutate({ policy: "alert" })}
            type="radio"
          />{" "}
          Conservar la Cita y crear una alerta
        </label>
        <label className="block">
          <input
            checked={policy.data === "cancel-after-third-reminder"}
            disabled={update.isPending}
            name="no-show-policy"
            onChange={() =>
              update.mutate({ policy: "cancel-after-third-reminder" })
            }
            type="radio"
          />{" "}
          Cancelar tras el tercer recordatorio sin respuesta
        </label>
      </fieldset>
    </section>
  );
}
