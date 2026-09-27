import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createInboundAlertResolutionAnnouncement,
  getSupervisionOperationStatusLabel,
  InboundAlertResolutionStatus,
  SupervisionTechnicalDetails,
} from "./supervision-diagnostics";

describe("detalles y anuncios de supervisión", () => {
  it("expone los diagnósticos técnicos dentro de un disclosure accesible", () => {
    const html = renderToStaticMarkup(
      createElement(
        SupervisionTechnicalDetails,
        { summary: "Diagnóstico técnico de Pagos" },
        createElement("p", null, "Estado de la operación"),
      ),
    );

    expect(html).toContain("<details");
    expect(html).toContain(">Diagnóstico técnico de Pagos</summary>");
    expect(html).toContain("Estado de la operación");
    expect(html).toContain("focus-visible:outline-2");
  });

  it("presenta los estados técnicos de mutaciones sin depender del color", () => {
    const labels = {
      idle: "Sin operación",
      pending: "En proceso",
      success: "Completada",
    };

    expect(getSupervisionOperationStatusLabel("idle", labels)).toBe(
      "Sin operación",
    );
    expect(getSupervisionOperationStatusLabel("pending", labels)).toBe(
      "En proceso",
    );
    expect(getSupervisionOperationStatusLabel("success", labels)).toBe(
      "Completada",
    );
    expect(getSupervisionOperationStatusLabel("error", labels)).toBe("Error");
  });

  it("anuncia cuando se resuelve una alerta entrante", () => {
    expect(
      createInboundAlertResolutionAnnouncement({
        alertId: "alert-12345678",
        listUpdated: true,
        resolved: true,
      }),
    ).toBe("Alerta de recepción alert-12 resuelta. Se actualizó el listado.");
    expect(
      createInboundAlertResolutionAnnouncement({
        alertId: "alert-12345678",
        listUpdated: true,
        resolved: false,
      }),
    ).toBe(
      "No se confirmó la resolución de la alerta alert-12; se actualizó el listado.",
    );
    expect(
      createInboundAlertResolutionAnnouncement({
        alertId: "alert-12345678",
        listUpdated: false,
        resolved: true,
      }),
    ).toBe(
      "Alerta de recepción alert-12 resuelta. No se pudo actualizar el listado.",
    );

    const html = renderToStaticMarkup(
      createElement(InboundAlertResolutionStatus, {
        message: "Alerta de recepción resuelta. Se actualizó el listado.",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(
      "Alerta de recepción resuelta. Se actualizó el listado.",
    );
  });
});
