import type { WhatsAppConnectionAlert } from "~/domain/whatsapp-connection-alert";
import {
  whatsappReadinessReconciliationMaxAttempts,
  type WhatsAppReadinessReconciliation,
} from "~/domain/whatsapp-readiness-reconciliation";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { formatDateTime } from "./format-date";

const reconciliationStatusLabels: Record<
  WhatsAppReadinessReconciliation["status"],
  string
> = {
  blocked: "Requiere intervención",
  pending: "Reintento programado",
  processing: "En curso",
  succeeded: "Vigilando la conexión",
};

export function WhatsAppReadinessReconciliationPanel({
  alerts,
  reconciliation,
}: {
  alerts: WhatsAppConnectionAlert[];
  reconciliation: WhatsAppReadinessReconciliation;
}) {
  const openAlerts = alerts.filter((alert) => alert.status === "open");
  const alertsToShow =
    openAlerts.length > 0
      ? openAlerts
      : reconciliation.status === "blocked"
        ? [
            {
              id: "blocked-reconciliation",
              nextAction:
                "Contacte al equipo de soporte de Praxia y solicite revisar la conexión de WhatsApp de su Clínica.",
              reason:
                "La reconciliación automática no pudo completar la configuración y requiere una revisión.",
            },
          ]
        : [];

  return (
    <section
      aria-label="Seguimiento automático de WhatsApp"
      className="space-y-3"
      data-whatsapp-readiness-reconciliation="true"
    >
      <div className="border-border rounded-lg border p-4 text-sm">
        <p className="font-medium">
          Reconciliación: {reconciliationStatusLabels[reconciliation.status]}
        </p>
        {reconciliation.status !== "succeeded" && (
          <p className="text-muted-foreground mt-1">
            {reconciliation.attempts} de{" "}
            {whatsappReadinessReconciliationMaxAttempts} intentos
          </p>
        )}
        {reconciliation.nextAttemptAt !== null ? (
          <p className="text-muted-foreground mt-1">
            Próxima revisión automática:{" "}
            {formatDateTime(reconciliation.nextAttemptAt)}
          </p>
        ) : reconciliation.status === "blocked" ? (
          <p className="text-muted-foreground mt-1">
            No hay otra revisión automática programada.
          </p>
        ) : null}
        {reconciliation.lastAttemptAt !== null && (
          <p className="text-muted-foreground mt-1">
            Último intento: {formatDateTime(reconciliation.lastAttemptAt)}
          </p>
        )}
      </div>
      {alertsToShow.map((alert) => (
        <Alert key={alert.id} variant="warning">
          <AlertTitle>
            Se requiere una acción para completar WhatsApp
          </AlertTitle>
          <AlertDescription>
            <p>{alert.reason}</p>
            <p className="mt-2">
              <strong>Siguiente paso:</strong> {alert.nextAction}
            </p>
          </AlertDescription>
        </Alert>
      ))}
    </section>
  );
}
