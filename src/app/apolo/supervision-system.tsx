"use client";

import { useState } from "react";

import {
  groupSupervisionSystemProblems,
  type SupervisionSystemProblemGroup,
  type SupervisionSystemProblemSeverity,
} from "~/domain/supervision-system";
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

const severityLabels: Record<SupervisionSystemProblemSeverity, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
};

export function SupervisionSystem() {
  const [resolutionAnnouncement, setResolutionAnnouncement] = useState("");
  const [clinicFilter, setClinicFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [search, setSearch] = useState("");
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
  const problemGroups = system.data
    ? groupSupervisionSystemProblems(system.data.globalProblems)
    : [];
  const clinics = uniqueSorted(
    problemGroups.flatMap((group) =>
      group.clinicId && group.clinicName
        ? [{ id: group.clinicId, name: group.clinicName }]
        : [],
    ),
    (clinic) => clinic.id,
    (clinic) => clinic.name,
  );
  const areas = uniqueSorted(
    problemGroups.map((group) => group.area),
    (area) => area,
    (area) => area,
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredProblemGroups = problemGroups.filter((group) => {
    if (clinicFilter === "global" && group.clinicId !== null) return false;
    if (
      clinicFilter !== "all" &&
      clinicFilter !== "global" &&
      group.clinicId !== clinicFilter
    ) {
      return false;
    }
    if (areaFilter !== "all" && group.area !== areaFilter) return false;
    if (severityFilter !== "all" && group.severity !== severityFilter) {
      return false;
    }
    if (!normalizedSearch) return true;
    return [
      group.clinicName,
      group.area,
      group.reason,
      group.nextAction,
      group.resourceLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const rawProblemCount = system.data?.globalProblems.length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Sistema</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Proveedor de mensajería, colas de workers e incidencias globales.
        </p>
      </header>

      {system.isLoading ? (
        <p role="status">Consultando estado del sistema…</p>
      ) : null}
      {system.error ? (
        <p role="alert" className="text-destructive">
          {system.error.message}
        </p>
      ) : null}
      {system.data ? (
        <>
          <section
            aria-labelledby="system-provider-title"
            className="border-border bg-card rounded-xl border p-4"
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
                  className="border-border bg-card min-w-0 rounded-xl border p-4"
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
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold" id="system-problems-title">
                Incidencias abiertas · {problemGroups.length} grupos ·{" "}
                {rawProblemCount} alertas
              </h3>
              <p className="text-muted-foreground text-sm">
                Agrupadas por Clínica, causa y recurso; prioridad y antigüedad.
              </p>
            </div>
            {problemGroups.length ? (
              <>
                <div className="border-border bg-muted grid gap-3 rounded-xl border p-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Clínica</span>
                    <select
                      className="border-border bg-card text-foreground focus-visible:outline-primary w-full rounded-md border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      onChange={(event) => setClinicFilter(event.target.value)}
                      value={clinicFilter}
                    >
                      <option value="all">Todas las Clínicas</option>
                      <option value="global">Incidencias globales</option>
                      {clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>
                          {clinic.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Área</span>
                    <select
                      className="border-border bg-card text-foreground focus-visible:outline-primary w-full rounded-md border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      onChange={(event) => setAreaFilter(event.target.value)}
                      value={areaFilter}
                    >
                      <option value="all">Todas las áreas</option>
                      {areas.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Severidad</span>
                    <select
                      className="border-border bg-card text-foreground focus-visible:outline-primary w-full rounded-md border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      onChange={(event) =>
                        setSeverityFilter(event.target.value)
                      }
                      value={severityFilter}
                    >
                      <option value="all">Todas</option>
                      <option value="critical">Crítica</option>
                      <option value="high">Alta</option>
                      <option value="medium">Media</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Buscar</span>
                    <input
                      className="border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:outline-primary w-full rounded-md border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Clínica, causa o recurso"
                      type="search"
                      value={search}
                    />
                  </label>
                </div>
                <p aria-live="polite" className="text-muted-foreground text-sm">
                  Mostrando {filteredProblemGroups.length} de{" "}
                  {problemGroups.length} grupos
                </p>
                {filteredProblemGroups.length ? (
                  <ul className="space-y-3">
                    {filteredProblemGroups.map((group) => (
                      <li key={group.id}>
                        <ProblemGroupCard group={group} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p
                    className="border-border bg-card rounded-lg border p-3"
                    role="status"
                  >
                    No hay grupos que coincidan con estos filtros.
                  </p>
                )}
              </>
            ) : (
              <p
                className="border-border bg-card rounded-lg border p-3"
                role="status"
              >
                No hay incidencias globales abiertas.
              </p>
            )}
          </section>
        </>
      ) : null}

      <div id="system-diagnostics">
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
                    system.data.provider.missing.includes(
                      "KAPSO_WEBHOOK_SECRET",
                    ),
                  )}
                </p>
                <p>Los valores de los secretos no se muestran.</p>
              </div>
            ) : null}
            <section
              aria-labelledby="inbound-alerts-title"
              className="space-y-2"
            >
              <h3 className="font-semibold" id="inbound-alerts-title">
                Recepción de WhatsApp
              </h3>
              {inboundAlerts.isLoading ? (
                <p role="status">Consultando alertas de recepción…</p>
              ) : null}
              {inboundAlerts.error ? (
                <p role="alert" className="text-destructive">
                  {inboundAlerts.error.message}
                </p>
              ) : null}
              {inboundAlerts.data?.length === 0 ? (
                <p>No hay alertas de recepción abiertas.</p>
              ) : null}
              {inboundAlerts.data?.map((alert) => (
                <article
                  className="border-border bg-card rounded-lg border p-3"
                  key={alert.id}
                >
                  <p>{alert.reason}</p>
                  <p className="text-muted-foreground mt-1 break-words">
                    Conexión: <code>{alert.connectionReference}</code> ·
                    customer:{" "}
                    <code>{alert.customerReference ?? "no informado"}</code>
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Siguiente acción: {alert.nextAction}
                  </p>
                  <button
                    className="border-border text-primary focus-visible:outline-primary mt-3 rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
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
                <p role="alert" className="text-destructive">
                  {resolveInboundAlert.error.message}
                </p>
              ) : null}
              {resolutionAnnouncement ? (
                <InboundAlertResolutionStatus
                  message={resolutionAnnouncement}
                />
              ) : null}
            </section>
          </div>
        </SupervisionTechnicalDetails>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function secretLabel(isMissing: boolean) {
  return isMissing ? "No configurada" : "Configurada o no requerida";
}

function ProblemGroupCard({ group }: { group: SupervisionSystemProblemGroup }) {
  const destination = getProblemDestination(group);

  return (
    <article className="border-warning-border bg-card space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={severityBadgeClass(group.severity)}>
              Severidad {severityLabels[group.severity]}
            </span>
            <span className="border-border bg-muted text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
              {group.count}{" "}
              {group.count === 1 ? "alerta abierta" : "alertas abiertas"}
            </span>
          </div>
          <h4 className="font-semibold break-words">
            {group.clinicName ?? "Incidencia global"} · {group.area}
          </h4>
          <p className="text-muted-foreground text-sm">
            Recurso: {group.resourceLabel}
          </p>
        </div>
        {destination ? (
          <a
            className="border-border text-primary focus-visible:outline-primary shrink-0 rounded-md border px-3 py-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            href={destination.href}
          >
            {destination.label}
          </a>
        ) : null}
      </div>

      <p className="text-sm break-words">{group.reason}</p>
      <p className="text-muted-foreground text-sm break-words">
        Siguiente acción: {group.nextAction}
      </p>

      <dl className="bg-muted grid gap-2 rounded-lg p-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground text-xs">Primera aparición</dt>
          <dd>{formatDateTime(group.firstSeenAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Última aparición</dt>
          <dd>{formatDateTime(group.lastSeenAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Antigüedad</dt>
          <dd>{formatAge(group.firstSeenAt)}</dd>
        </div>
      </dl>

      <details className="border-border border-t pt-3">
        <summary className="text-primary focus-visible:outline-primary cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Ver alertas originales ({group.problems.length})
        </summary>
        <ul className="mt-3 space-y-2">
          {group.problems.map((problem) => (
            <li
              className="border-border bg-muted rounded-lg border p-3 text-sm"
              key={`${problem.source ?? "problem"}-${problem.id}`}
            >
              <p className="break-words">{problem.reason}</p>
              {problem.resourceReference ? (
                <p className="text-muted-foreground mt-1 break-all">
                  Recurso de origen: <code>{problem.resourceReference}</code>
                </p>
              ) : null}
              <p className="text-muted-foreground mt-1">
                Abierta: {formatDateTime(problem.createdAt)} · Última
                actualización:{" "}
                {formatDateTime(problem.lastSeenAt ?? problem.createdAt)}
              </p>
              <p className="text-muted-foreground mt-1">
                Acción: {problem.nextAction}
              </p>
              <p className="text-muted-foreground mt-1 text-xs break-all">
                ID: <code>{problem.id}</code>
              </p>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function severityBadgeClass(severity: SupervisionSystemProblemSeverity) {
  if (severity === "critical") {
    return "rounded-full border border-destructive px-2 py-0.5 text-xs font-semibold text-destructive";
  }
  if (severity === "high") {
    return "rounded-full border border-warning-border px-2 py-0.5 text-xs font-semibold text-warning-foreground";
  }
  return "rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground";
}

function getProblemDestination(group: SupervisionSystemProblemGroup) {
  if (
    group.clinicId !== null &&
    (group.source === "connection" ||
      group.source === "circuit-breaker" ||
      group.source === "readiness")
  ) {
    return {
      href: `/apolo?clinicId=${encodeURIComponent(group.clinicId)}&tab=whatsapp`,
      label: "Abrir WhatsApp de la Clínica",
    };
  }
  if (group.source === "inbound") {
    return {
      href: "/apolo?tab=system#system-diagnostics",
      label: "Revisar recepción de WhatsApp",
    };
  }
  return null;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatAge(createdAt: Date) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - createdAt.valueOf()) / 60_000),
  );
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function uniqueSorted<T>(
  items: T[],
  keyOf: (item: T) => string,
  labelOf: (item: T) => string = keyOf,
) {
  const unique = new Map(items.map((item) => [keyOf(item), item]));
  return [...unique.values()].sort((left, right) =>
    labelOf(left).localeCompare(labelOf(right), "es"),
  );
}
