"use client";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import { api } from "~/trpc/react";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

/** Bandeja de Panacea para diálogos que requieren atención humana. */
export function ConversationEscalationsSection() {
  const escalations = api.panacea.listConversationEscalations.useQuery();
  const resolve = api.panacea.resolveConversationEscalation.useMutation({
    onSuccess: () => escalations.refetch(),
  });

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">Escalamientos</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Conversaciones que requieren la atención de una persona de la
            Clínica.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {escalations.error ? (
            <PanaceaQueryError
              error={escalations.error}
              onRetry={() => void escalations.refetch()}
              title="Escalamientos"
            />
          ) : escalations.isLoading ? (
            <PanaceaQueryLoading label="Cargando Escalamientos" />
          ) : escalations.data?.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay Escalamientos pendientes.
            </p>
          ) : null}
          <ul className="space-y-2 text-sm">
            {escalations.data?.map((escalation) => (
              <li
                className="border-border space-y-2 rounded-lg border p-3"
                key={escalation.id}
              >
                <p>
                  {escalation.contact.name}: {triggerLabel(escalation.trigger)}.
                </p>
                <p className="text-muted-foreground">
                  Recibido: {formatDate(escalation.createdAt)}
                </p>
                <Button
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate({ escalationId: escalation.id })
                  }
                  size="sm"
                  type="button"
                >
                  {resolve.isPending ? "Cerrando…" : "Cerrar Escalamiento"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

function triggerLabel(trigger: ConversationEscalationTrigger) {
  switch (trigger) {
    case "human-request":
      return "solicitó atención humana";
    case "frustration":
      return "expresó frustración";
    case "misunderstanding":
      return "tuvo dos fallos consecutivos de comprensión";
  }
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
