"use client";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import { api } from "~/trpc/react";

/** Bandeja mínima de Panacea para solicitudes que requieren decisión humana. */
export function AppointmentSelfManagementEscalationsSection() {
  const escalations =
    api.panacea.listAppointmentSelfManagementEscalations.useQuery();
  const resolve =
    api.panacea.resolveAppointmentSelfManagementEscalation.useMutation({
      onSuccess: () => escalations.refetch(),
    });

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Escalamientos de Citas</h2>
        <p className="mt-1 text-sm text-slate-300">
          Solicitudes de Asclepio que requieren resolución en Panacea.
        </p>
      </div>
      {escalations.data?.length === 0 ? (
        <p className="text-sm text-slate-400">
          No hay Escalamientos pendientes.
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {escalations.data?.map((escalation) => (
          <li
            className="rounded border border-slate-800 p-3"
            key={escalation.id}
          >
            <p>
              {escalation.contact.name} solicitó{" "}
              {actionLabel(escalation.action)} la Cita{" "}
              {escalation.appointmentId}.
            </p>
            {escalation.requestedStartsAt ? (
              <p className="text-slate-300">
                Nuevo inicio solicitado:{" "}
                {formatDate(escalation.requestedStartsAt)}
              </p>
            ) : null}
            <p className="text-slate-400">
              Recibido: {formatDate(escalation.createdAt)}
            </p>
            <button
              className="mt-2 rounded bg-teal-300 px-3 py-1 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ escalationId: escalation.id })}
              type="button"
            >
              {resolve.isPending ? "Cerrando…" : "Cerrar Escalamiento"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function actionLabel(action: "cancel" | "reschedule") {
  return action === "cancel" ? "cancelar" : "reprogramar";
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
