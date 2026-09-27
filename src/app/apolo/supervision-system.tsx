"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import {
  createInboundAlertResolutionAnnouncement,
  InboundAlertResolutionStatus,
  SupervisionTechnicalDetails,
} from "./supervision-diagnostics";

const workerStatusLabels = {
  attention: "Requiere atención",
  idle: "Sin trabajo pendiente",
  "not-configured": "Programador sin configurar",
  working: "Trabajo pendiente o en proceso",
} as const;

export function SupervisionSystem() {
  const [resolutionAnnouncement, setResolutionAnnouncement] = useState("");
  const system = api.apolo.getSupervisionSystemOverview.useQuery();
  const inboundAlerts = api.apolo.listWhatsAppInboundAlerts.useQuery();
  const resolveInboundAlert = api.apolo.resolveWhatsAppInboundAlert.useMutation(
    {
      onMutate: () => setResolutionAnnouncement(""),
      onSuccess: async (resolved, input) => {
        const refreshedAlerts = await inboundAlerts.refetch();
        setResolutionAnnouncement(
          createInboundAlertResolutionAnnouncement({
            alertId: input.alertId,
            listUpdated: !refreshedAlerts.isError,
            resolved,
          }),
        );
      },
    },
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Sistema</h2>
        <p className="mt-1 text-sm text-slate-300">
          Proveedor de mensajería, colas de workers e incidencias globales.
        </p>
      </header>

      {system.isLoading ? (
        <p role="status">Consultando estado del sistema…</p>
      ) : null}
      {system.error ? (
        <p role="alert" className="text-amber-200">
          {system.error.message}
        </p>
      ) : null}
      {system.data ? (
        <>
          <section
            aria-labelledby="system-provider-title"
            className="rounded-xl border border-slate-700 p-4"
          >
            <h3 className="font-semibold" id="system-provider-title">
              Proveedor activo
            </h3>
            <p className="mt-2">
              {system.data.provider.id === "kapso" ? "Kapso" : "Simulado"} ·{" "}
              {system.data.provider.configured
                ? "Configurado"
                : "Requiere configuración"}
            </p>
          </section>

          <section aria-labelledby="system-workers-title" className="space-y-3">
            <h3 className="text-lg font-semibold" id="system-workers-title">
              Workers y colas
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {system.data.workers.map((worker) => (
                <article
                  className="min-w-0 rounded-xl border border-slate-700 p-4"
                  key={worker.key}
                >
                  <h4 className="font-semibold">{worker.label}</h4>
                  <p className="mt-1 text-sm">
                    Estado: {workerStatusLabels[worker.status]}
                  </p>
                  <p className="text-sm">
                    Configuración del scheduler:{" "}
                    {worker.configuration === "ready"
                      ? "Disponible"
                      : "Falta SCHEDULER_SECRET"}
                  </p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <Count label="Pendientes" value={worker.queue.pending} />
                    <Count label="En proceso" value={worker.queue.processing} />
                    <Count label="Atención" value={worker.queue.attention} />
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="system-problems-title"
            className="space-y-3"
          >
            <h3 className="text-lg font-semibold" id="system-problems-title">
              Incidencias globales ({system.data.globalProblems.length})
            </h3>
            {system.data.globalProblems.length ? (
              <ul className="space-y-2">
                {system.data.globalProblems.map((problem) => (
                  <li
                    className="rounded-lg border border-amber-400/70 p-3"
                    key={`${problem.area}-${problem.id}`}
                  >
                    <p className="font-medium">
                      {problem.area}
                      {problem.clinicName ? ` · ${problem.clinicName}` : ""}
                    </p>
                    <p className="mt-1 text-sm break-words">{problem.reason}</p>
                    <p className="mt-1 text-sm text-slate-300">
                      Siguiente acción: {problem.nextAction}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="rounded-lg border border-slate-700 p-3"
                role="status"
              >
                No hay incidencias globales abiertas.
              </p>
            )}
          </section>
        </>
      ) : null}

      <SupervisionTechnicalDetails summary="Diagnóstico técnico">
        <div className="space-y-4 text-sm">
          {system.data ? (
            <div>
              <p>
                Credencial API Kapso:{" "}
                {secretLabel(
                  system.data.provider.missing.includes("KAPSO_API_KEY"),
                )}
              </p>
              <p>
                Secreto de webhook:{" "}
                {secretLabel(
                  system.data.provider.missing.includes("KAPSO_WEBHOOK_SECRET"),
                )}
              </p>
              <p>Los valores de los secretos no se muestran.</p>
            </div>
          ) : null}
          <section aria-labelledby="inbound-alerts-title" className="space-y-2">
            <h3 className="font-semibold" id="inbound-alerts-title">
              Recepción de WhatsApp
            </h3>
            {inboundAlerts.isLoading ? (
              <p role="status">Consultando alertas de recepción…</p>
            ) : null}
            {inboundAlerts.error ? (
              <p role="alert" className="text-amber-200">
                {inboundAlerts.error.message}
              </p>
            ) : null}
            {inboundAlerts.data?.length === 0 ? (
              <p>No hay alertas de recepción abiertas.</p>
            ) : null}
            {inboundAlerts.data?.map((alert) => (
              <article
                className="rounded-lg border border-slate-700 p-3"
                key={alert.id}
              >
                <p>{alert.reason}</p>
                <p className="mt-1 break-words text-slate-300">
                  Conexión: <code>{alert.connectionReference}</code> · customer:{" "}
                  <code>{alert.customerReference ?? "no informado"}</code>
                </p>
                <p className="mt-1 text-slate-300">
                  Siguiente acción: {alert.nextAction}
                </p>
                <button
                  className="mt-3 rounded border border-slate-500 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200 disabled:opacity-50"
                  disabled={resolveInboundAlert.isPending}
                  onClick={() =>
                    resolveInboundAlert.mutate({ alertId: alert.id })
                  }
                  type="button"
                >
                  Corregí la conexión; reintentar
                </button>
              </article>
            ))}
            {resolveInboundAlert.error ? (
              <p role="alert" className="text-amber-200">
                {resolveInboundAlert.error.message}
              </p>
            ) : null}
            {resolutionAnnouncement ? (
              <InboundAlertResolutionStatus message={resolutionAnnouncement} />
            ) : null}
          </section>
        </div>
      </SupervisionTechnicalDetails>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function secretLabel(isMissing: boolean) {
  return isMissing ? "No configurada" : "Configurada o no requerida";
}
