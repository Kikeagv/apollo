"use client";

import { useState } from "react";

import {
  whatsappConnectionNextAction,
  whatsappConnectionStatusLabel,
  type WhatsAppConnection,
} from "~/domain/whatsapp-connection";
import {
  whatsappSetupLinkStatus,
  whatsappSetupLinkStatusLabel,
} from "~/domain/whatsapp-setup-link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { api } from "~/trpc/react";
import { formatDateTime } from "./format-date";
import {
  setupLinkActionLabel,
  setupLinkNextActionLabel,
  setupLinkProviderStatusLabel,
} from "./whatsapp-setup-link-presentation";
import {
  PanaceaQueryEmpty,
  PanaceaQueryError,
  PanaceaQueryLoading,
} from "./panacea-query-state";
import { WhatsAppReadinessReconciliationPanel } from "./whatsapp-readiness-reconciliation-panel";

const providerLabels: Record<WhatsAppConnection["provider"], string> = {
  kapso: "Kapso",
  simulated: "Simulado",
};

function formatLastTest(lastTestAt: Date | string | null) {
  if (lastTestAt === null) return "Sin prueba registrada";
  return formatDateTime(lastTestAt);
}

function formatSetupLinkDate(value: Date | string) {
  return formatDateTime(value);
}

function badgeVariant(status: WhatsAppConnection["status"]) {
  if (status === "ready") return "success" as const;
  if (status === "degraded" || status === "pending") return "warning" as const;
  return "outline" as const;
}

function readinessBadgeVariant(
  status: "pending" | "ready" | "degraded" | "blocked" | "failed",
) {
  if (status === "ready") return "success" as const;
  if (status === "pending" || status === "failed") return "warning" as const;
  return "outline" as const;
}

function readinessStatusLabel(
  status: "pending" | "ready" | "degraded" | "blocked",
) {
  return {
    blocked: "Bloqueado",
    degraded: "Degradado",
    pending: "Pendiente",
    ready: "Listo técnicamente",
  }[status];
}

function gateStatusLabel(status: "pending" | "ready" | "blocked" | "failed") {
  return {
    blocked: "Bloqueado",
    failed: "Falló",
    pending: "Pendiente",
    ready: "Correcto",
  }[status];
}

function readinessGateLabel(
  code: "number" | "webhooks" | "templates" | "billing" | "e2e",
) {
  return {
    billing: "Billing y crédito",
    e2e: "Prueba extremo a extremo",
    number: "Número y WABA",
    templates: "Plantillas críticas",
    webhooks: "Webhooks",
  }[code];
}

/** Estado operativo de la conexión; nunca muestra credenciales de proveedor. */
export function WhatsAppConnectionSection() {
  const connection = api.panacea.getWhatsAppConnection.useQuery();

  return (
    <section
      aria-labelledby="whatsapp-connection-title"
      className="space-y-5"
      data-whatsapp-connection="true"
    >
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold" id="whatsapp-connection-title">
            Conexión de WhatsApp
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Estado de la relación aislada entre esta Clínica, su número y el
            proveedor de WhatsApp.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {connection.error ? (
            <PanaceaQueryError
              error={connection.error}
              onRetry={() => void connection.refetch()}
              title="la conexión de WhatsApp"
            />
          ) : connection.isLoading ? (
            <PanaceaQueryLoading label="Cargando la conexión de WhatsApp" />
          ) : connection.data === undefined ? (
            <PanaceaQueryEmpty
              description="Esta Clínica todavía no tiene una conexión registrada. Complete la configuración para habilitar el siguiente paso."
              onRetry={() => void connection.refetch()}
              title="Conexión no registrada"
            />
          ) : (
            <ConnectionDetails connection={connection.data} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** Gates técnicos visibles al propietario; nunca equivalen al gate legal. */
export function WhatsAppReadinessSection() {
  const readiness = api.panacea.getWhatsAppReadiness.useQuery();
  const snapshot = readiness.data;

  return (
    <section
      aria-labelledby="whatsapp-readiness-title"
      className="space-y-5"
      data-whatsapp-readiness="true"
    >
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold" id="whatsapp-readiness-title">
            Readiness técnico de WhatsApp
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            La Conexión solo puede enviar cuando los gates técnicos están
            correctos. Esta señal no autoriza datos reales.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          {readiness.error ? (
            <PanaceaQueryError
              error={readiness.error}
              onRetry={() => void readiness.refetch()}
              title="el readiness de WhatsApp"
            />
          ) : readiness.isLoading ? (
            <PanaceaQueryLoading label="Cargando el readiness de WhatsApp" />
          ) : snapshot === undefined ? (
            <PanaceaQueryEmpty
              description="Complete la configuración de WhatsApp para consultar sus gates técnicos."
              onRetry={() => void readiness.refetch()}
              title="Readiness no disponible"
            />
          ) : snapshot.connection === null ? (
            <PanaceaQueryEmpty
              description="Esta Clínica todavía no tiene una Conexión de WhatsApp provisionada. Complete el enlace de configuración para habilitar el readiness técnico."
              onRetry={() => void readiness.refetch()}
              title="Conexión no registrada"
            />
          ) : snapshot.connection?.provider !== "kapso" ? (
            <p className="text-muted-foreground text-sm leading-6">
              El modo simulado no usa los gates productivos de Kapso. El gate
              legal y el consentimiento siguen siendo independientes.
            </p>
          ) : (
            <>
              <WhatsAppReadinessReconciliationPanel
                alerts={snapshot.alerts ?? []}
                reconciliation={snapshot.reconciliation}
              />
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">Estado técnico</span>
                <Badge
                  variant={readinessBadgeVariant(snapshot.readiness.status)}
                >
                  {readinessStatusLabel(snapshot.readiness.status)}
                </Badge>
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Siguiente acción</dt>
                  <dd className="mt-1 font-medium">
                    {snapshot.readiness.nextAction ?? "Ninguna"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Última prueba E2E</dt>
                  <dd className="mt-1 font-medium">
                    {snapshot.e2e.lastTestAt === null
                      ? "Sin evidencia"
                      : snapshot.e2e.evidenceScope === "webhook-preflight"
                        ? `Preflight de webhook · ${formatDateTime(snapshot.e2e.lastTestAt)}`
                        : formatDateTime(snapshot.e2e.lastTestAt)}
                  </dd>
                </div>
              </dl>
              <ul className="space-y-3" data-whatsapp-readiness-gates="true">
                {snapshot.readiness.gates.map((gate) => (
                  <li
                    className="border-border rounded-lg border p-3"
                    key={gate.code}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {readinessGateLabel(gate.code)}
                      </span>
                      <Badge variant={readinessBadgeVariant(gate.status)}>
                        {gateStatusLabel(gate.status)}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {gate.message}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="border-warning-border bg-warning-muted text-warning-foreground rounded-lg border p-4 text-sm leading-6">
                Readiness técnico listo no significa autorización legal para
                datos reales. Mantenga Consentimiento de WhatsApp, privacidad,
                contrato y minimización cerrados antes de habilitar tráfico.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** Flujo de configuración iniciado por el Médico propietario desde la Clínica. */
export function WhatsAppSetupLinkSection() {
  const [offboardingConfirmation, setOffboardingConfirmation] = useState(false);
  const onboarding = api.panacea.getKapsoOnboarding.useQuery();
  const manageSetupLink = api.panacea.manageKapsoWhatsAppSetupLink.useMutation({
    onSuccess: () => void onboarding.refetch(),
  });
  const authorizeOffboarding =
    api.panacea.authorizeWhatsAppOffboarding.useMutation({
      onSuccess: () => {
        setOffboardingConfirmation(false);
        void onboarding.refetch();
      },
    });
  const snapshot = onboarding.data;
  const setupLink = snapshot?.setupLink ?? null;
  const status = setupLink === null ? null : whatsappSetupLinkStatus(setupLink);
  const preflightPassed = snapshot?.preflight?.status === "passed";

  return (
    <Card data-whatsapp-setup-link="true">
      <CardHeader className="border-border border-b">
        <h2 className="text-xl font-semibold">Enlace de configuración</h2>
        <p className="text-muted-foreground leading-6 text-pretty">
          Inicie la configuración de WhatsApp desde esta Clínica. El enlace dura
          30 días y solo se muestra a la sesión autenticada del Médico
          propietario.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        {onboarding.error ? (
          <PanaceaQueryError
            error={onboarding.error}
            onRetry={() => void onboarding.refetch()}
            title="el enlace de configuración"
          />
        ) : onboarding.isLoading ? (
          <PanaceaQueryLoading label="Cargando el enlace de configuración" />
        ) : snapshot === undefined ? null : (
          <>
            <div className="border-border bg-muted/20 rounded-lg border p-4 text-sm leading-6">
              <p>
                El flujo usa coexistencia y facturación administrada por el
                partner. El propietario completa directamente OTP, QR,
                contraseña y credenciales de Meta; Praxia no los guarda ni los
                muestra.
              </p>
              {snapshot.preflight?.status !== "passed" ? (
                <p className="text-muted-foreground mt-2">
                  Primero complete el preflight de WhatsApp.{" "}
                  {snapshot.preflight?.nextAction ??
                    "Todavía no se ha ejecutado."}
                </p>
              ) : null}
            </div>
            {setupLink !== null && status !== null ? (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Estado</dt>
                  <dd className="mt-1">
                    <Badge
                      variant={status === "active" ? "success" : "warning"}
                    >
                      {whatsappSetupLinkStatusLabel(status)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vence</dt>
                  <dd className="mt-1 font-medium">
                    {formatSetupLinkDate(setupLink.expiresAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Revocado</dt>
                  <dd className="mt-1 font-medium">
                    {setupLink.revokedAt === null
                      ? "No"
                      : formatSetupLinkDate(setupLink.revokedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Estado remoto</dt>
                  <dd className="mt-1 font-medium">
                    {setupLinkProviderStatusLabel(
                      snapshot.setupLinkProviderStatus,
                    )}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Siguiente acción</dt>
                  <dd className="mt-1 font-medium">
                    {setupLinkNextActionLabel(
                      setupLink,
                      snapshot.setupLinkProviderStatus,
                      snapshot.setupLinkProviderError,
                    )}
                  </dd>
                </div>
              </dl>
            ) : null}
            {snapshot.setupLinkProviderError !== null ? (
              <p className="text-destructive text-sm" role="status">
                {snapshot.setupLinkProviderError}
              </p>
            ) : null}
            {snapshot.setupLinkHistory.length > 0 ? (
              <SetupLinkHistory events={snapshot.setupLinkHistory} />
            ) : null}
            <div className="flex flex-wrap gap-3">
              {setupLink !== null && status === "active" ? (
                <a
                  className="border-primary text-primary hover:bg-primary/10 inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-medium"
                  href={setupLink.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir enlace de configuración
                </a>
              ) : null}
              <Button
                disabled={!preflightPassed || manageSetupLink.isPending}
                onClick={() => manageSetupLink.mutate({ action: "generate" })}
                type="button"
              >
                {status === "active"
                  ? "Continuar con el enlace"
                  : "Generar enlace"}
              </Button>
            </div>
            {manageSetupLink.error ? (
              <p className="text-destructive text-sm" role="alert">
                {manageSetupLink.error.message}
              </p>
            ) : null}
            <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-4 text-sm leading-6">
              <p className="font-medium">Autorizar salida de Praxia</p>
              <p className="text-muted-foreground mt-1">
                Solo el Médico propietario puede autorizar que un superadmin
                retire esta Conexión. El número, WABA y plantillas permanecen en
                la cuenta de la Clínica.
              </p>
              {snapshot.connection?.offboardingAuthorizedAt ? (
                <p className="mt-2">
                  Autorización registrada el{" "}
                  {formatDateTime(snapshot.connection.offboardingAuthorizedAt)}.
                </p>
              ) : (
                <>
                  <label className="mt-3 flex items-center gap-2">
                    <input
                      checked={offboardingConfirmation}
                      onChange={(event) =>
                        setOffboardingConfirmation(event.target.checked)
                      }
                      type="checkbox"
                    />
                    Confirmo la autorización de salida de esta Clínica.
                  </label>
                  <Button
                    className="mt-3"
                    disabled={
                      !offboardingConfirmation ||
                      authorizeOffboarding.isPending ||
                      snapshot.connection === null
                    }
                    onClick={() =>
                      authorizeOffboarding.mutate({
                        manualConfirmation: true,
                      })
                    }
                    type="button"
                  >
                    {authorizeOffboarding.isPending
                      ? "Registrando…"
                      : "Autorizar offboarding"}
                  </Button>
                </>
              )}
              {authorizeOffboarding.error ? (
                <p className="text-destructive mt-2" role="alert">
                  {authorizeOffboarding.error.message}
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SetupLinkHistory({
  events,
}: {
  events: {
    action: string;
    actorIdentityId: string;
    occurredAt: Date | string;
    reason: string;
    result: string;
    setupLinkId: string | null;
  }[];
}) {
  return (
    <div className="border-border rounded-lg border p-4 text-sm">
      <p className="font-medium">Historial reciente</p>
      <ol className="text-muted-foreground mt-3 space-y-3">
        {events.map((event, index) => (
          <li key={`${String(event.occurredAt)}-${event.action}-${index}`}>
            <p className="text-foreground font-medium">
              {setupLinkActionLabel(event.action)} · {event.result}
            </p>
            <p>{event.reason}</p>
            <p>
              {formatDateTime(event.occurredAt)} · actor {event.actorIdentityId}
              {event.setupLinkId ? ` · enlace ${event.setupLinkId}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ConnectionDetails({ connection }: { connection: WhatsAppConnection }) {
  const nextAction =
    connection.metadata.nextAction ?? whatsappConnectionNextAction(connection);
  const statusReason = connection.metadata.statusReason;
  const businessAccountId =
    connection.businessAccountId ?? connection.metadata.businessAccountId;

  return (
    <div
      className="space-y-6"
      data-whatsapp-connection-status={connection.status}
    >
      <dl className="grid gap-5 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-sm">Proveedor</dt>
          <dd className="mt-1 font-medium">
            {providerLabels[connection.provider]}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">Estado</dt>
          <dd className="mt-1">
            <Badge variant={badgeVariant(connection.status)}>
              {whatsappConnectionStatusLabel(connection.status)}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">Última prueba</dt>
          <dd className="mt-1 font-medium">
            {formatLastTest(connection.lastTestAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">Siguiente acción</dt>
          <dd className="mt-1 font-medium">{nextAction}</dd>
        </div>
      </dl>
      {statusReason !== undefined && statusReason !== null ? (
        <p
          className="border-border bg-muted/20 rounded-lg border p-4 text-sm leading-6"
          role="status"
        >
          {statusReason}
        </p>
      ) : null}
      <div className="border-border bg-muted/20 rounded-lg border p-4 text-sm">
        <p className="font-medium">Identificadores operativos</p>
        <dl className="text-muted-foreground mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt>Número E.164</dt>
            <dd className="text-foreground break-all">
              {connection.phoneNumberE164 ?? "No asignado"}
            </dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd className="text-foreground break-all">{connection.customer}</dd>
          </div>
          <div>
            <dt>phone_number_id</dt>
            <dd className="text-foreground break-all">
              {connection.phoneNumberId ?? "No asignado"}
            </dd>
          </div>
          <div>
            <dt>WABA / business account</dt>
            <dd className="text-foreground break-all">
              {businessAccountId ?? "No asignado"}
            </dd>
          </div>
        </dl>
        <p className="text-muted-foreground mt-3">
          Estos datos son operativos; las credenciales, OTP y secretos nunca se
          guardan ni se muestran aquí.
        </p>
      </div>
    </div>
  );
}
