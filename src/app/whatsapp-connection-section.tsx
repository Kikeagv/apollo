"use client";

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

/** Flujo de configuración iniciado por el Médico propietario desde la Clínica. */
export function WhatsAppSetupLinkSection() {
  const onboarding = api.panacea.getKapsoOnboarding.useQuery();
  const manageSetupLink = api.panacea.manageKapsoWhatsAppSetupLink.useMutation({
    onSuccess: () => void onboarding.refetch(),
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
