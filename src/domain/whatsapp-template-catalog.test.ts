import { describe, expect, it } from "vitest";

import { whatsappCriticalTemplateCatalog } from "./whatsapp-readiness";

describe("catálogo común de plantillas de WhatsApp", () => {
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
});
