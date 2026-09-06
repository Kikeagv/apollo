"use client";

import {
  whatsappConnectionNextAction,
  whatsappConnectionStatusLabel,
  type WhatsAppConnection,
} from "~/domain/whatsapp-connection";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { api } from "~/trpc/react";
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
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(lastTestAt));
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

function ConnectionDetails({ connection }: { connection: WhatsAppConnection }) {
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
          <dd className="mt-1 font-medium">
            {whatsappConnectionNextAction(connection)}
          </dd>
        </div>
      </dl>
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
        </dl>
        <p className="text-muted-foreground mt-3">
          Estos datos son operativos; las credenciales, OTP y secretos nunca se
          guardan ni se muestran aquí.
        </p>
      </div>
    </div>
  );
}
