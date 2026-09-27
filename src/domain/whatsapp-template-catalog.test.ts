import { describe, expect, it } from "vitest";

import { whatsappCriticalTemplateCatalog } from "./whatsapp-readiness";
import {
  buildWhatsAppTemplateCatalogCoverage,
  type WhatsAppTemplateCoverageSource,
} from "./whatsapp-template-catalog";

const source: WhatsAppTemplateCoverageSource[] = [
  {
    clinicId: "clinic-1",
    clinicName: "Clínica Central",
    businessAccountId: "waba-1",
    provisioningEventId: "generation-1",
    templates: [
      {
        kind: "confirmation",
        catalogVersion: 1,
        provisioningEventId: "generation-1",
        provisioningStatus: "approved",
        rejectionReason: null,
        providerTemplateId: "remote-confirmation",
        status: "APPROVED",
        syncedAt: new Date("2026-09-20T12:00:00.000Z"),
      },
      {
        kind: "reminder",
        catalogVersion: 1,
        provisioningEventId: "generation-old",
        provisioningStatus: "approved",
        rejectionReason: null,
        providerTemplateId: "remote-reminder-old",
        status: "APPROVED",
        syncedAt: new Date("2026-09-20T12:00:00.000Z"),
      },
      {
        kind: "cancellation",
        catalogVersion: 1,
        provisioningEventId: "generation-1",
        provisioningStatus: "rejected",
        rejectionReason: "La definición debe corregirse",
        providerTemplateId: "remote-cancellation",
        status: "REJECTED",
        syncedAt: new Date("2026-09-20T12:00:00.000Z"),
      },
    ],
  },
];

describe("cobertura del catálogo común de plantillas", () => {
  it("conserva una definición versionada completa para cada mensaje de cita", () => {
    expect(whatsappCriticalTemplateCatalog).toHaveLength(4);

    for (const definition of whatsappCriticalTemplateCatalog) {
      expect(definition.version).toBeGreaterThan(0);
      expect(definition.content).toContain("{{patient_name}}");
      expect(definition.content).toContain("{{clinic_name}}");
      expect(definition.content).toContain("{{appointment_date}}");
      expect(definition.content).toContain("{{appointment_time}}");
      expect(definition.content).toContain("{{doctor_name}}");
      for (const variable of definition.variables) {
        expect(typeof definition.examples[variable]).toBe("string");
      }
    }
  });

  it("muestra la definición versionada y el estado actual por WABA", () => {
    const result = buildWhatsAppTemplateCatalogCoverage(source);
    const clinic = result.wabas[0];

    expect(result.definitions).toHaveLength(4);
    expect(result.definitions[0]).toMatchObject({
      version: 1,
      name: "appointment_confirmation",
      category: "UTILITY",
    });
    expect(clinic?.templates).toMatchObject([
      { kind: "confirmation", status: "approved" },
      { kind: "reminder", status: "outdated" },
      { kind: "cancellation", status: "rejected" },
      { kind: "reschedule", status: "missing" },
    ]);
    expect(clinic?.templates[2]?.rejectionReason).toBe(
      "La definición debe corregirse",
    );
  });

  it("no considera aprobada una plantilla de otra generación aunque coincida la versión", () => {
    const result = buildWhatsAppTemplateCatalogCoverage(source);
    const reminder = result.wabas[0]?.templates.find(
      (template) => template.kind === "reminder",
    );

    expect(reminder?.status).toBe("outdated");
    expect(reminder?.providerTemplateId).toBe("remote-reminder-old");
    expect(whatsappCriticalTemplateCatalog).toHaveLength(4);
  });
});
