"use client";

import { useState } from "react";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import type {
  ConversationEscalationResolution,
  ConversationEscalationTrigger,
} from "~/server/application/conversation-escalations";
import { api } from "~/trpc/react";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

/** Bandeja de Panacea para diálogos que requieren atención humana. */
export function ConversationEscalationsSection() {
  const escalations = api.panacea.listConversationEscalations.useQuery();
  const [lastResolution, setLastResolution] =
    useState<ConversationEscalationResolution | null>(null);
  const resolve = api.panacea.resolveConversationEscalation.useMutation({
    onSuccess: (resolution) => {
      if (resolution !== null) setLastResolution(resolution);
      void escalations.refetch();
    },
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
          {lastResolution ? (
            <div
              aria-live="polite"
              className="border-border bg-muted/30 space-y-2 rounded-lg border p-3 text-sm"
            >
              <p className="font-medium">Escalamiento reanudado</p>
              <p className="text-muted-foreground">
                Reanudado por: {lastResolution.resolvedBy.name}
              </p>
              <p className="text-muted-foreground">
                Fecha de reanudación: {formatDate(lastResolution.resolvedAt)}
              </p>
              <p className="text-muted-foreground">
                Siguiente acción: continuar la conversación; el asistente de la
                Clínica vuelve a atender mensajes de texto.
              </p>
            </div>
          ) : null}
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
                <p className="text-muted-foreground">
                  Siguiente acción: revisar la conversación y cerrar este
                  Escalamiento para reanudar el asistente. El actor queda
                  auditado en Pendientes resueltos.
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
    case "business-app":
      return "escribió desde WhatsApp Business App; el asistente de la Clínica permanece en silencio";
    case "human-request":
      return "solicitó atención humana";
    case "frustration":
      return "expresó frustración";
    case "guardianship-pending":
      return "requiere verificación de representación de Tutor";
    case "misunderstanding":
      return "tuvo dos fallos consecutivos de comprensión";
    case "unsupported-message":
      return "envió un tipo de mensaje que requiere atención humana";
  }
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
