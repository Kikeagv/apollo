"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

/** Bandeja de Panacea para Entregas que agotaron su política de reintentos. */
export function TransactionalDeliveryAlertsSection() {
  const [resolutionEvidence, setResolutionEvidence] = useState<
    Record<string, string>
  >({});
  const alerts = api.panacea.listTransactionalDeliveryAlerts.useQuery();
  const resolve = api.panacea.resolveTransactionalDeliveryAlert.useMutation({
    onSuccess: async () => {
      setResolutionEvidence({});
      await alerts.refetch();
    },
  });

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">Entregas pendientes</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Mensajes administrativos que requieren atención.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {alerts.error ? (
            <PanaceaQueryError
              error={alerts.error}
              onRetry={() => void alerts.refetch()}
              title="Entregas pendientes"
            />
          ) : alerts.isLoading ? (
            <PanaceaQueryLoading label="Cargando Entregas pendientes" />
          ) : alerts.data?.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay Entregas que requieran atención.
            </p>
          ) : null}
          <ul className="space-y-2 text-sm">
            {alerts.data?.map((alert) => {
              const evidence = resolutionEvidence[alert.id] ?? "";
              return (
                <li
                  className="border-border space-y-2 rounded-lg border p-3"
                  key={alert.id}
                >
                  <p>
                    {alert.delivery.kind === "appointment-reminder"
                      ? "Recordatorio de Cita"
                      : alert.delivery.kind === "appointment-message"
                        ? "Mensaje de Cita"
                        : "Agenda diaria"}
                    {alert.delivery.lastError
                      ? `: ${alert.delivery.lastError}`
                      : "."}
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor={"delivery-alert-evidence-" + alert.id}>
                      Evidencia de resolución
                    </Label>
                    <Textarea
                      id={"delivery-alert-evidence-" + alert.id}
                      maxLength={500}
                      onChange={(event) =>
                        setResolutionEvidence((current) => ({
                          ...current,
                          [alert.id]: event.target.value,
                        }))
                      }
                      placeholder="Describa la acción realizada."
                      value={evidence}
                    />
                  </div>
                  <Button
                    disabled={resolve.isPending || evidence.trim() === ""}
                    onClick={() =>
                      resolve.mutate({
                        alertId: alert.id,
                        resolutionEvidence: evidence.trim(),
                      })
                    }
                    size="sm"
                    type="button"
                  >
                    {resolve.isPending ? "Cerrando…" : "Marcar como resuelta"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
