"use client";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import { api } from "~/trpc/react";

/** Bandeja de Panacea para diálogos que requieren atención humana. */
export function ConversationEscalationsSection() {
  const escalations = api.panacea.listConversationEscalations.useQuery();
  const resolve = api.panacea.resolveConversationEscalation.useMutation({
    onSuccess: () => escalations.refetch(),
  });

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Escalamientos</h2>
        <p className="mt-1 text-sm text-slate-300">
          Conversaciones que requieren la atención de una persona de la Clínica.
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
              {escalation.contact.name}: {triggerLabel(escalation.trigger)}.
            </p>
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

function triggerLabel(trigger: ConversationEscalationTrigger) {
  switch (trigger) {
    case "human-request":
      return "solicitó atención humana";
    case "frustration":
      return "expresó frustración";
    case "misunderstanding":
      return "tuvo dos fallos consecutivos de comprensión";
  }
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
