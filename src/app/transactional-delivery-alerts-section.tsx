"use client";

import { api } from "~/trpc/react";

/** Bandeja de Panacea para Entregas que agotaron su política de reintentos. */
export function TransactionalDeliveryAlertsSection() {
  const alerts = api.panacea.listTransactionalDeliveryAlerts.useQuery();
  const resolve = api.panacea.resolveTransactionalDeliveryAlert.useMutation({
    onSuccess: () => alerts.refetch(),
  });

  return (
    <section className="space-y-3 rounded-xl border border-amber-700/60 p-5">
      <div>
        <h2 className="text-xl font-semibold">Entregas pendientes</h2>
        <p className="mt-1 text-sm text-slate-300">
          Mensajes administrativos que no pudieron entregarse tras cinco
          intentos.
        </p>
      </div>
      {alerts.data?.length === 0 ? (
        <p className="text-sm text-slate-400">
          No hay Entregas que requieran atención.
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {alerts.data?.map((alert) => (
          <li className="rounded border border-slate-800 p-3" key={alert.id}>
            <p>
              {alert.delivery.kind === "appointment-reminder"
                ? "Recordatorio de Cita"
                : "Agenda diaria"}
              {alert.delivery.lastError ? `: ${alert.delivery.lastError}` : "."}
            </p>
            <button
              className="mt-2 rounded bg-teal-300 px-3 py-1 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ alertId: alert.id })}
              type="button"
            >
              {resolve.isPending ? "Cerrando…" : "Marcar como resuelta"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
