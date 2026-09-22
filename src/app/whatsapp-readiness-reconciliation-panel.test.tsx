import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WhatsAppConnectionAlert } from "~/domain/whatsapp-connection-alert";
import type { WhatsAppReadinessReconciliation } from "~/domain/whatsapp-readiness-reconciliation";

import { WhatsAppReadinessReconciliationPanel } from "./whatsapp-readiness-reconciliation-panel";
import { formatDateTime } from "./format-date";

const now = new Date("2026-09-22T12:00:00.000Z");

function reconciliation(
  overrides: Partial<WhatsAppReadinessReconciliation> = {},
): WhatsAppReadinessReconciliation {
  return {
    attempts: 1,
    lastAttemptAt: now,
    lastError: null,
    nextAttemptAt: new Date("2026-09-22T12:00:10.000Z"),
    status: "pending",
    ...overrides,
  };
}

function alert(
  overrides: Partial<WhatsAppConnectionAlert> = {},
): WhatsAppConnectionAlert {
  return {
    clinicId: "clinic-1",
    createdAt: now,
    gateCode: "webhooks",
    id: "alert-1",
    nextAction: "Confirme la URL del webhook y solicite soporte.",
    provisioningEventId: "event-1",
    reason: "Kapso no pudo activar el webhook.",
    resolvedAt: null,
    status: "open",
    updatedAt: now,
    ...overrides,
  };
}

describe("panel de reconciliación de WhatsApp para la Clínica", () => {
  it("muestra a la Clínica la alerta abierta y una acción concreta", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsAppReadinessReconciliationPanel, {
        alerts: [alert()],
        reconciliation: reconciliation({
          attempts: 3,
          nextAttemptAt: null,
          status: "blocked",
        }),
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Requiere intervención");
    expect(html).toContain("Kapso no pudo activar el webhook.");
    expect(html).toContain("Confirme la URL del webhook y solicite soporte.");
    expect(html).toContain("3 de 3 intentos");
  });

  it("muestra cuándo se volverá a consultar un estado pendiente", () => {
    const nextAttemptAt = new Date("2026-09-22T12:00:10.000Z");
    const html = renderToStaticMarkup(
      createElement(WhatsAppReadinessReconciliationPanel, {
        alerts: [],
        reconciliation: reconciliation({ nextAttemptAt }),
      }),
    );

    expect(html).toContain("Próxima revisión automática");
    expect(html).toContain(formatDateTime(nextAttemptAt));
    expect(html).toContain("1 de 3 intentos");
  });

  it("muestra una acción segura si el bloqueo no tiene alerta durable", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsAppReadinessReconciliationPanel, {
        alerts: [],
        reconciliation: reconciliation({
          lastError:
            "Kapso devolvió más de un número para la Clínica; requiere intervención humana",
          nextAttemptAt: null,
          status: "blocked",
        }),
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Contacte al equipo de soporte");
    expect(html).not.toContain("Kapso devolvió más de un número");
  });

  it("no vuelve a mostrar alertas que ya fueron resueltas", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsAppReadinessReconciliationPanel, {
        alerts: [alert({ status: "resolved", resolvedAt: now })],
        reconciliation: reconciliation({ status: "succeeded" }),
      }),
    );

    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Vigilando la conexión");
  });
});
