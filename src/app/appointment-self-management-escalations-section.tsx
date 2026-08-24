"use client";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { api } from "~/trpc/react";

/** Bandeja mínima de Panacea para solicitudes que requieren decisión humana. */
export function AppointmentSelfManagementEscalationsSection() {
  const escalations =
    api.panacea.listAppointmentSelfManagementEscalations.useQuery();
  const resolve =
    api.panacea.resolveAppointmentSelfManagementEscalation.useMutation({
      onSuccess: () => escalations.refetch(),
    });

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">Escalamientos de Citas</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Solicitudes que requieren la decisión de una persona de la Clínica.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {escalations.data?.length === 0 ? (
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
                  {escalation.contact.name} solicitó{" "}
                  {actionLabel(escalation.action)} la Cita{" "}
                  {escalation.appointmentId}.
                </p>
                {escalation.requestedStartsAt ? (
                  <p className="text-muted-foreground">
                    Nuevo inicio solicitado:{" "}
                    {formatDate(escalation.requestedStartsAt)}
                  </p>
                ) : null}
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

function actionLabel(action: "cancel" | "reschedule") {
  return action === "cancel" ? "cancelar" : "reprogramar";
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
