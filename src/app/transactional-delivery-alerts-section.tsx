"use client";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";

/** Bandeja de Panacea para Entregas que agotaron su política de reintentos. */
export function TransactionalDeliveryAlertsSection() {
  const alerts = api.panacea.listTransactionalDeliveryAlerts.useQuery();
  const resolve = api.panacea.resolveTransactionalDeliveryAlert.useMutation({
    onSuccess: () => alerts.refetch(),
  });

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">Entregas pendientes</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Mensajes administrativos que no pudieron entregarse tras cinco
            intentos.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {alerts.data?.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay Entregas que requieran atención.
            </p>
          ) : null}
          <ul className="space-y-2 text-sm">
            {alerts.data?.map((alert) => (
              <li
                className="border-border space-y-2 rounded-lg border p-3"
                key={alert.id}
              >
                <p>
                  {alert.delivery.kind === "appointment-reminder"
                    ? "Recordatorio de Cita"
                    : "Agenda diaria"}
                  {alert.delivery.lastError
                    ? `: ${alert.delivery.lastError}`
                    : "."}
                </p>
                <Button
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ alertId: alert.id })}
                  size="sm"
                  type="button"
                >
                  {resolve.isPending ? "Cerrando…" : "Marcar como resuelta"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
