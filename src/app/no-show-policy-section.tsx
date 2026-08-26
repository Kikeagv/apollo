"use client";

import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

/** Control de Panacea para la Política de inasistencia por silencio. */
export function NoShowPolicySection() {
  const policy = api.panacea.getNoShowPolicy.useQuery();
  const update = api.panacea.setNoShowPolicy.useMutation({
    onSuccess: () => policy.refetch(),
  });
  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">Inasistencia por silencio</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Tras el recordatorio de 20 horas, conserve la Cita o cancélela
            automáticamente si el Contacto no respondió.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {policy.error ? (
            <PanaceaQueryError
              error={policy.error}
              onRetry={() => void policy.refetch()}
              title="la política de inasistencia"
            />
          ) : policy.isLoading ? (
            <PanaceaQueryLoading label="Cargando la política de inasistencia" />
          ) : (
            <fieldset className="space-y-3 text-sm">
              <label className="flex items-start gap-3">
                <input
                  checked={policy.data === "alert"}
                  className="accent-primary mt-0.5 size-4"
                  disabled={update.isPending}
                  name="no-show-policy"
                  onChange={() => update.mutate({ policy: "alert" })}
                  type="radio"
                />
                <span>Conservar la Cita y crear una alerta</span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  checked={policy.data === "cancel-after-third-reminder"}
                  className="accent-primary mt-0.5 size-4"
                  disabled={update.isPending}
                  name="no-show-policy"
                  onChange={() =>
                    update.mutate({ policy: "cancel-after-third-reminder" })
                  }
                  type="radio"
                />
                <span>Cancelar tras el tercer recordatorio sin respuesta</span>
              </label>
            </fieldset>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
