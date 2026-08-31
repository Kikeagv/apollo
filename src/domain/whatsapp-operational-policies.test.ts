import { describe, expect, it } from "vitest";

import {
  NO_SHOW_POLICIES,
  NO_SHOW_POLICY_LABELS,
  isNoShowPolicy,
  normalizeSecretaryPhoneE164,
} from "./whatsapp-operational-policies";

describe("políticas operativas de Atención por WhatsApp", () => {
  it("expone las dos políticas de inasistencia del canal", () => {
    expect(NO_SHOW_POLICIES).toEqual(["alert", "cancel-after-third-reminder"]);
    expect(NO_SHOW_POLICY_LABELS).toEqual({
      alert: "Conservar la Cita y crear una alerta",
      "cancel-after-third-reminder":
        "Cancelar tras el tercer recordatorio sin respuesta",
    });
    expect(isNoShowPolicy("alert")).toBe(true);
    expect(isNoShowPolicy("unsupported-policy")).toBe(false);
  });

  it("acepta y normaliza un teléfono E.164, y trata vacío como ausencia", () => {
    expect(normalizeSecretaryPhoneE164(" +50370000000 ")).toBe("+50370000000");
    expect(normalizeSecretaryPhoneE164("  ")).toBeNull();
    expect(normalizeSecretaryPhoneE164(null)).toBeNull();
  });

  it("rechaza un teléfono que no tenga formato E.164", () => {
    expect(() => normalizeSecretaryPhoneE164("503-7000-0000")).toThrow(
      "El número de secretaria debe usar formato E.164",
    );
  });
});
