import { describe, expect, it } from "vitest";

import {
  clinicInvitationUrl,
  getClinicInvitationNextAction,
  getClinicInvitationStatus,
} from "./clinic-invitation";

const now = new Date("2026-09-17T12:00:00.000Z");

describe("clinic invitation lifecycle", () => {
  it("uses the configured public origin for activation links", () => {
    expect(
      clinicInvitationUrl(
        "https://app.praxia.test/internal-origin/",
        "token with spaces",
      ),
    ).toBe(
      "https://app.praxia.test/activar-invitacion?token=token%20with%20spaces",
    );
  });

  it("keeps an unconsumed, unexpired invitation pending", () => {
    expect(
      getClinicInvitationStatus({
        consumedAt: null,
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
        now,
      }),
    ).toBe("pending");
  });

  it("prioritizes accepted over expiration", () => {
    expect(
      getClinicInvitationStatus({
        consumedAt: new Date("2026-09-16T12:00:00.000Z"),
        expiresAt: new Date("2026-09-16T12:00:00.000Z"),
        now,
      }),
    ).toBe("accepted");
  });

  it("marks an unconsumed invitation as expired at its deadline", () => {
    expect(
      getClinicInvitationStatus({
        consumedAt: null,
        expiresAt: now,
        now,
      }),
    ).toBe("expired");
  });

  it.each([
    ["pending", null, "retry-delivery"],
    ["pending", "failed", "retry-delivery"],
    ["expired", "succeeded", "renew"],
    ["accepted", "succeeded", "none"],
  ] as const)(
    "maps %s with last delivery %s to next action %s",
    (status, lastDelivery, expected) => {
      expect(getClinicInvitationNextAction({ status, lastDelivery })).toBe(
        expected,
      );
    },
  );

  it("waits while another delivery attempt owns the lease", () => {
    expect(
      getClinicInvitationNextAction({
        deliveryInProgress: true,
        lastDelivery: null,
        status: "pending",
      }),
    ).toBe("wait-delivery");
  });
});
