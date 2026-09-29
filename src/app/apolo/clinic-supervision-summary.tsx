"use client";

import type {
  ClinicSupervisionState,
  ClinicSupervisionStatus,
} from "~/domain/clinic-supervision";
import { formatDateTime } from "~/app/format-date";
import type { SupervisionTabId } from "~/domain/supervision-navigation";
import { api } from "~/trpc/react";
import { SupervisionTechnicalDetails } from "./supervision-diagnostics";

const statusLabels: Record<ClinicSupervisionStatus, string> = {
  attention: "Requiere atención",
  blocked: "Bloqueado",
  pending: "Pendiente",
  ready: "Listo",
};

const statusBadgeClasses: Record<ClinicSupervisionStatus, string> = {
  attention: "border-warning-border bg-warning-muted text-warning-foreground",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
  pending: "border-border bg-muted text-muted-foreground",
  ready: "border-primary/25 bg-primary/5 text-primary",
};

const statusAccentClasses: Record<ClinicSupervisionStatus, string> = {
  attention: "border-l-warning",
  blocked: "border-l-destructive",
  pending: "border-l-border",
  ready: "border-l-primary",
};

const messagingModeClasses = {
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
  enabled: "border-primary/25 bg-primary/5 text-primary",
  offboarded: "border-border bg-muted text-muted-foreground",
  "synthetic-only":
    "border-warning-border bg-warning-muted text-warning-foreground",
} as const;

const destinations: Record<
  ClinicSupervisionState["destination"],
  SupervisionTabId
> = {
  owner: "support",
  payments: "payments",
  whatsapp: "whatsapp",
};

type PrimaryBlocker = {
  action: ClinicSupervisionState["action"];
  cause: string;
  destination: ClinicSupervisionState["destination"];
  label: string;
  nextAction: string;
  responsible: string;
  state: ClinicSupervisionState | null;
  status: ClinicSupervisionStatus;
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
        className="border-border bg-card text-muted-foreground rounded-lg border p-4"
        role="status"
      >
        Selecciona una Clínica para ver su resumen de supervisión.
      </p>
    );
  }
  if (summary.isLoading) {
    return (
      <p className="text-muted-foreground" role="status">
        Cargando resumen…
      </p>
    );
  }
  if (summary.error) {
    return (
      <p className="text-warning-foreground" role="alert">
        {summary.error.message}
      </p>
    );
  }
  if (!summary.data) {
    return (
      <p className="text-muted-foreground" role="status">
        La Clínica ya no está disponible.
      </p>
    );
  }

  const data = summary.data;
  const primaryBlocker = selectPrimaryBlocker(
    data.states,
    data.messagingMode,
    data.messagingModeReason,
  );
  const visibleStates = primaryBlocker?.state
    ? data.states.filter((state) => state.key !== primaryBlocker.state?.key)
    : data.states;
  const connectionState = data.states.find(
    (state) => state.key === "whatsapp-connection",
  );

  return (
    <div className="text-foreground space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{data.clinic.name}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Entorno: {data.clinic.isSynthetic ? "sintético" : "comercial"}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Última consulta: {formatDateTime(new Date(summary.dataUpdatedAt))}
          </p>
        </div>
        <p
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${messagingModeClasses[data.messagingMode]}`}
          role="status"
        >
          Tráfico real: {messagingModeLabel(data.messagingMode)}
        </p>
      </div>

      <section
        aria-labelledby="clinic-supervision-primary-title"
        className={`border-border bg-card rounded-xl border border-l-4 p-5 shadow-sm ${primaryBlocker ? statusAccentClasses[primaryBlocker.status] : ""}`}
      >
        <h3
          className="text-lg font-semibold"
          id="clinic-supervision-primary-title"
        >
          {primaryBlocker
            ? primaryBlocker.status === "blocked"
              ? "Qué bloquea la operación"
              : "Qué requiere atención primero"
            : "Estado general"}
        </h3>
        {primaryBlocker ? (
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{primaryBlocker.label}</p>
              <StatusBadge status={primaryBlocker.status} />
            </div>
            <p>{primaryBlocker.cause}</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Responsable</dt>
                <dd className="mt-1 font-medium">
                  {primaryBlocker.responsible}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Siguiente paso</dt>
                <dd className="mt-1 font-medium">
                  {primaryBlocker.nextAction}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {primaryBlocker.action === "retry-owner-invitation" ? (
                <button
                  className="bg-primary text-primary-foreground focus-visible:ring-ring/30 min-h-10 rounded-lg px-4 py-2 font-medium transition-colors outline-none hover:opacity-90 focus-visible:ring-3 disabled:cursor-wait disabled:opacity-60"
                  disabled={retryInvitation.isPending}
                  onClick={() => retryInvitation.mutate({ clinicId })}
                  type="button"
                >
                  {retryInvitation.isPending
                    ? "Reenviando…"
                    : "Reenviar invitación"}
                </button>
              ) : (
                <DestinationButton
                  destination={primaryBlocker.destination}
                  onClick={() =>
                    onNavigate(destinations[primaryBlocker.destination])
                  }
                  primary
                />
              )}
              {primaryBlocker.action === "retry-owner-invitation" ? (
                <DestinationButton
                  destination={primaryBlocker.destination}
                  onClick={() =>
                    onNavigate(destinations[primaryBlocker.destination])
                  }
                />
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground mt-2">
            Los estados de acceso, suscripción, conexión y capacidad están
            listos. El modo de mensajería se indica por separado.
          </p>
        )}
      </section>

      {retryInvitation.error ? (
        <p
          className="border-warning-border bg-warning-muted text-warning-foreground rounded-lg border p-3 text-sm"
          role="alert"
        >
          {retryInvitation.error.message}
        </p>
      ) : null}
      {retryInvitation.isSuccess ? (
        <p
          className="border-border bg-muted text-primary rounded-lg border p-3 text-sm"
          role="status"
        >
          Invitación reenviada. Actualizando estado…
        </p>
      ) : null}

      <section aria-labelledby="clinic-supervision-states-title">
        <h3
          className="mb-3 text-lg font-semibold"
          id="clinic-supervision-states-title"
        >
          Estados por dimensión
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleStates.map((state) => (
            <StateCard
              isRetrying={retryInvitation.isPending}
              key={state.key}
              onNavigate={onNavigate}
              onRetry={() => retryInvitation.mutate({ clinicId })}
              ownerName={data.ownerName}
              state={state}
            />
          ))}
        </div>
      </section>

      <section
        aria-labelledby="supervision-usage-title"
        className="border-border bg-card rounded-xl border p-4"
      >
        <h3 className="font-semibold" id="supervision-usage-title">
          Saldo y uso de mensajería
        </h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Crédito disponible"
            value={formatCents(data.capacityMetrics.creditCents)}
          />
          <Metric
            label="Crédito reservado"
            value={formatCents(data.capacityMetrics.creditReserveCents)}
          />
          <Metric
            label="Consumo de cuota"
            value={`${data.capacityMetrics.quotaConsumed} mensajes`}
          />
          <Metric
            label="En curso / reservados"
            value={`${data.capacityMetrics.quotaInFlight} / ${data.capacityMetrics.quotaReserved}`}
          />
          <Metric
            label="Cuota mensual"
            value={
              data.capacityMetrics.monthlyQuota === null
                ? "Sin límite"
                : `${data.capacityMetrics.monthlyQuota} mensajes`
            }
          />
        </dl>
      </section>

      <SupervisionTechnicalDetails summary="Diagnóstico técnico de WhatsApp">
        <div className="space-y-2">
          <p>
            Conexión: {connectionState?.cause ?? "No hay datos de conexión."}
          </p>
          <p>
            Acción técnica:{" "}
            {connectionState?.nextAction ?? "Sin acción pendiente."}
          </p>
          <p>Modo de mensajería: {data.messagingModeReason}</p>
        </div>
      </SupervisionTechnicalDetails>
    </div>
  );
}

function StateCard({
  isRetrying,
  onNavigate,
  onRetry,
  ownerName,
  state,
}: {
  isRetrying: boolean;
  onNavigate: (tab: SupervisionTabId) => void;
  onRetry: () => void;
  ownerName: string | null;
  state: ClinicSupervisionState;
}) {
  const isReadyOwner = state.key === "owner-access" && state.status === "ready";

  return (
    <article
      aria-labelledby={`clinic-supervision-state-${state.key}`}
      className="border-border bg-card min-w-0 space-y-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4
          className="font-semibold"
          id={`clinic-supervision-state-${state.key}`}
        >
          {state.label}
        </h4>
        <StatusBadge status={state.status} />
      </div>
      {isReadyOwner ? (
        <p className="text-sm break-words">
          <span className="text-muted-foreground">Cuenta:</span>{" "}
          {ownerName ?? "Nombre no registrado"}
        </p>
      ) : (
        <p className="text-sm break-words">{state.value}</p>
      )}
      {state.status !== "ready" ? (
        state.action === "retry-owner-invitation" ? (
          <button
            className="bg-primary text-primary-foreground focus-visible:ring-ring/30 min-h-10 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none hover:opacity-90 focus-visible:ring-3 disabled:cursor-wait disabled:opacity-60"
            disabled={isRetrying}
            onClick={onRetry}
            type="button"
          >
            {isRetrying ? "Reenviando…" : "Reenviar invitación"}
          </button>
        ) : (
          <DestinationButton
            destination={state.destination}
            onClick={() => onNavigate(destinations[state.destination])}
          />
        )
      ) : null}
    </article>
  );
}

function StatusBadge({ status }: { status: ClinicSupervisionStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

function DestinationButton({
  destination,
  onClick,
  primary = false,
}: {
  destination: ClinicSupervisionState["destination"];
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      className={
        primary
          ? "bg-primary text-primary-foreground focus-visible:ring-ring/30 min-h-10 rounded-lg px-4 py-2 font-medium transition-colors outline-none hover:opacity-90 focus-visible:ring-3"
          : "border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring/30 min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3"
      }
      onClick={onClick}
      type="button"
    >
      Abrir {destinationLabel(destination)}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground font-medium break-words">{value}</dd>
    </div>
  );
}

function selectPrimaryBlocker(
  states: ClinicSupervisionState[],
  messagingMode: "blocked" | "enabled" | "offboarded" | "synthetic-only",
  messagingModeReason: string,
): PrimaryBlocker | null {
  const priority: Record<ClinicSupervisionStatus, number> = {
    blocked: 0,
    attention: 1,
    pending: 2,
    ready: 3,
  };
  const unresolvedStates = states
    .filter((state) => state.status !== "ready")
    .sort(
      (left, right) =>
        priority[left.status] - priority[right.status] ||
        Number(right.action !== null) - Number(left.action !== null),
    );
  const leadingState = unresolvedStates[0];

  if (leadingState) {
    return {
      action: leadingState.action,
      cause: leadingState.cause,
      destination: leadingState.destination,
      label: leadingState.label,
      nextAction: leadingState.nextAction,
      responsible: leadingState.responsible,
      state: leadingState,
      status: leadingState.status,
    };
  }

  if (messagingMode === "blocked") {
    return {
      action: "open-whatsapp",
      cause: messagingModeReason,
      destination: "whatsapp",
      label: "Tráfico real de WhatsApp",
      nextAction:
        "Revisar los gates pendientes y la habilitación de tráfico real.",
      responsible: "Equipo de activación de WhatsApp",
      state: null,
      status: "blocked",
    };
  }

  return null;
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
    blocked: "bloqueado",
    enabled: "habilitado",
    offboarded: "retirado",
    "synthetic-only": "no habilitado · solo pruebas sintéticas",
  }[mode];
}

function destinationLabel(destination: ClinicSupervisionState["destination"]) {
  return { owner: "Soporte", payments: "Pagos", whatsapp: "WhatsApp" }[
    destination
  ];
}
