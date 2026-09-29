import type { ReactNode } from "react";

export function getSupervisionOperationStatusLabel(
  status: "error" | "idle" | "pending" | "success",
  labels: { idle: string; pending: string; success: string },
) {
  if (status === "pending") return labels.pending;
  if (status === "success") return labels.success;
  if (status === "error") return "Error";
  return labels.idle;
}

export function SupervisionTechnicalDetails({
  summary,
  children,
  id,
  open,
}: {
  summary: string;
  children?: ReactNode;
  id?: string;
  open?: boolean;
}) {
  return (
    <details
      className="border-border rounded-xl border p-4"
      id={id}
      open={open}
    >
      <summary className="focus-visible:outline-ring cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        {summary}
      </summary>
      <div className="mt-3 space-y-3 text-sm">{children}</div>
    </details>
  );
}

export function InboundAlertResolutionStatus({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="text-primary text-sm" role="status">
      {message}
    </p>
  );
}

export function createInboundAlertResolutionAnnouncement({
  alertId,
  listUpdated,
  resolved,
}: {
  alertId: string;
  listUpdated: boolean;
  resolved: boolean;
}) {
  const reference = alertId.slice(0, 8);
  if (resolved && listUpdated) {
    return `Alerta de recepción ${reference} resuelta. Se actualizó el listado.`;
  }
  if (resolved) {
    return `Alerta de recepción ${reference} resuelta. No se pudo actualizar el listado.`;
  }
  if (listUpdated) {
    return `No se confirmó la resolución de la alerta ${reference}; se actualizó el listado.`;
  }
  return `No se confirmó la resolución de la alerta ${reference} y no se pudo actualizar el listado.`;
}
