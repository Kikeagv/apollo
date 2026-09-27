"use client";

import type { ClinicSupervisionState } from "~/domain/clinic-supervision";
import type { SupervisionTabId } from "~/domain/supervision-navigation";
import { api } from "~/trpc/react";
import { SupervisionTechnicalDetails } from "./supervision-diagnostics";

const statusLabels = {
  attention: "Requiere atención",
  blocked: "Bloqueado",
  pending: "Pendiente",
  ready: "Listo",
} as const;

const statusClasses = {
  attention: "border-amber-400/70",
  blocked: "border-rose-400/70",
  pending: "border-sky-400/70",
  ready: "border-emerald-400/70",
} as const;

const destinations: Record<
  ClinicSupervisionState["destination"],
  SupervisionTabId
> = {
  owner: "support",
  payments: "payments",
  whatsapp: "whatsapp",
};

export function ClinicSupervisionSummary({
  clinicId,
  onNavigate,
}: {
  clinicId: string;
  onNavigate: (tab: SupervisionTabId) => void;
}) {
  const summary = api.apolo.getClinicSupervisionSummary.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const retryInvitation = api.apolo.retryClinicInvitation.useMutation({
    onSuccess: () => void summary.refetch(),
    onError: () => void summary.refetch(),
  });

  if (!clinicId) {
    return (
      <p
        className="rounded-lg border border-slate-700 p-4 text-slate-300"
        role="status"
      >
        Selecciona una Clínica para ver su resumen de supervisión.
      </p>
    );
  }
  if (summary.isLoading) {
    return (
      <p className="text-slate-300" role="status">
        Cargando resumen…
      </p>
    );
  }
  if (summary.error) {
    return (
      <p className="text-amber-200" role="alert">
        {summary.error.message}
      </p>
    );
  }
  if (!summary.data) {
    return (
      <p className="text-slate-300" role="status">
        La Clínica ya no está disponible.
      </p>
    );
  }

  const stateByKey = new Map(
    summary.data.states.map((state) => [state.key, state]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{summary.data.clinic.name}</h2>
          <p className="mt-1 text-sm text-slate-300">
            Entorno:{" "}
            {summary.data.clinic.isSynthetic ? "sintético" : "comercial"} ·
            Mensajería: {messagingModeLabel(summary.data.messagingMode)}
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {summary.data.messagingModeReason}
          </p>
        </div>
        <p
          className="rounded border border-slate-600 px-3 py-2 text-sm"
          role="status"
        >
          Siguiente acción:{" "}
          {summary.data.nextAction?.nextAction ?? "Sin acciones pendientes."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.data.states.map((state) => (
          <article
            aria-labelledby={`supervision-state-${state.key}`}
            className={`min-w-0 space-y-3 rounded-xl border bg-slate-900/60 p-4 ${statusClasses[state.status]}`}
            key={state.key}
          >
            <div>
              <h3
                className="font-semibold"
                id={`supervision-state-${state.key}`}
              >
                {state.label}
              </h3>
              <p className="mt-1 text-sm font-medium">
                {statusLabels[state.status]} · {state.value}
              </p>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-slate-400">Causa</dt>
                <dd className="break-words">{state.cause}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Responsable</dt>
                <dd className="break-words">{state.responsible}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Siguiente acción</dt>
                <dd className="break-words">{state.nextAction}</dd>
              </div>
            </dl>
            <button
              className="rounded border border-slate-500 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200"
              onClick={() => onNavigate(destinations[state.destination])}
              type="button"
            >
              Abrir {destinationLabel(state.destination)}
            </button>
            {state.action === "retry-owner-invitation" ? (
              <button
                className="ml-2 rounded bg-teal-300 px-3 py-2 text-sm font-medium text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-100 disabled:opacity-50"
                disabled={retryInvitation.isPending}
                onClick={() => retryInvitation.mutate({ clinicId })}
                type="button"
              >
                {retryInvitation.isPending
                  ? "Reenviando…"
                  : "Reenviar invitación"}
              </button>
            ) : null}
          </article>
        ))}
      </div>

      <section
        aria-labelledby="supervision-capacity-title"
        className="rounded-xl border border-slate-700 p-4"
      >
        <h3 className="font-semibold" id="supervision-capacity-title">
          Capacidad de mensajería
        </h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Crédito disponible"
            value={formatCents(summary.data.capacityMetrics.creditCents)}
          />
          <Metric
            label="Crédito reservado"
            value={formatCents(summary.data.capacityMetrics.creditReserveCents)}
          />
          <Metric
            label="Consumo de cuota"
            value={`${summary.data.capacityMetrics.quotaConsumed} mensajes`}
          />
          <Metric
            label="En curso / reservados"
            value={`${summary.data.capacityMetrics.quotaInFlight} / ${summary.data.capacityMetrics.quotaReserved}`}
          />
          <Metric
            label="Cuota mensual"
            value={
              summary.data.capacityMetrics.monthlyQuota === null
                ? "Sin límite"
                : `${summary.data.capacityMetrics.monthlyQuota} mensajes`
            }
          />
        </dl>
        {retryInvitation.error ? (
          <p className="mt-3 text-sm text-amber-200" role="alert">
            {retryInvitation.error.message}
          </p>
        ) : null}
        {retryInvitation.isSuccess ? (
          <p className="mt-3 text-sm text-teal-200" role="status">
            Invitación reenviada. Actualizando estado…
          </p>
        ) : null}
      </section>
      <SupervisionTechnicalDetails summary="Diagnóstico técnico de WhatsApp">
        <div className="space-y-2">
          <p>Conexión: {stateByKey.get("whatsapp-connection")?.cause}</p>
          <p>Capacidad: {stateByKey.get("messaging-capacity")?.cause}</p>
          <p>
            Acción técnica: {stateByKey.get("messaging-capacity")?.nextAction}
          </p>
        </div>
      </SupervisionTechnicalDetails>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

function formatCents(value: number | null) {
  if (value === null) return "No registrado";
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function messagingModeLabel(
  mode: "blocked" | "enabled" | "offboarded" | "synthetic-only",
) {
  return {
    blocked: "bloqueada",
    enabled: "activa",
    offboarded: "retirada",
    "synthetic-only": "solo pruebas sintéticas",
  }[mode];
}

function destinationLabel(destination: ClinicSupervisionState["destination"]) {
  return { owner: "Soporte", payments: "Pagos", whatsapp: "WhatsApp" }[
    destination
  ];
}
