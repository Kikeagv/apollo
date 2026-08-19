import { describe, expect, it } from "vitest";

import { assertIdentityEmailDeliveryAllowed } from "./identity-email";

describe("selección del correo de Identidad", () => {
  it("prohíbe el adaptador simulado en producción", () => {
    expect(() =>
      assertIdentityEmailDeliveryAllowed({
        delivery: "simulated",
        nodeEnv: "production",
      }),
    ).toThrow(
      "IDENTITY_EMAIL_DELIVERY=simulated no está permitido en producción",
    );
  });

  it("permite Resend en producción", () => {
    expect(() =>
      assertIdentityEmailDeliveryAllowed({
        delivery: "resend",
        nodeEnv: "production",
      }),
    ).not.toThrow();
  });

  it("permite el modo simulado fuera de producción", () => {
    expect(() =>
      assertIdentityEmailDeliveryAllowed({
        delivery: "simulated",
        nodeEnv: "development",
      }),
    ).not.toThrow();
    expect(() =>
      assertIdentityEmailDeliveryAllowed({
        delivery: "simulated",
        nodeEnv: "test",
      }),
    ).not.toThrow();
  });
});
