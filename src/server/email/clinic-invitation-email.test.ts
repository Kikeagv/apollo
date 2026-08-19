import { describe, expect, it } from "vitest";

import { assertClinicInvitationEmailDeliveryAllowed } from "./clinic-invitation-email";

describe("guard de invitaciones de clínica", () => {
  it("rechaza el modo simulado en producción", () => {
    expect(() =>
      assertClinicInvitationEmailDeliveryAllowed({
        delivery: "simulated",
        nodeEnv: "production",
      }),
    ).toThrow(
      "IDENTITY_EMAIL_DELIVERY=simulated no permite invitaciones de clínica en producción",
    );
  });

  it("permite Resend en producción", () => {
    expect(() =>
      assertClinicInvitationEmailDeliveryAllowed({
        delivery: "resend",
        nodeEnv: "production",
      }),
    ).not.toThrow();
  });

  it("permite el modo simulado fuera de producción", () => {
    expect(() =>
      assertClinicInvitationEmailDeliveryAllowed({
        delivery: "simulated",
        nodeEnv: "development",
      }),
    ).not.toThrow();
    expect(() =>
      assertClinicInvitationEmailDeliveryAllowed({
        delivery: "simulated",
        nodeEnv: "test",
      }),
    ).not.toThrow();
  });
});
