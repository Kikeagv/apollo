import { describe, expect, it } from "vitest";

import {
  createKapsoWebhookSignature,
  verifyKapsoWebhookSignature,
} from "./kapso-webhook-security";

describe("seguridad del webhook Kapso", () => {
  it("firma el cuerpo crudo con HMAC-SHA256", () => {
    expect(
      createKapsoWebhookSignature('{"phone_number_id":"phone-1"}', "secret"),
    ).toBe(
      "sha256=d170e5f3478ed57063612331a5e821f19dfaad72901f9a9b50b6fa3d404fc69c",
    );
  });

  it("valida la firma con y sin el prefijo sha256", () => {
    const rawBody = '{"phone_number_id":"phone-1"}';
    const signature = createKapsoWebhookSignature(rawBody, "secret");

    expect(
      verifyKapsoWebhookSignature({ rawBody, secret: "secret", signature }),
    ).toBe(true);
    expect(
      verifyKapsoWebhookSignature({
        rawBody,
        secret: "secret",
        signature: signature.replace("sha256=", ""),
      }),
    ).toBe(true);
  });

  it.each([undefined, "sha256=wrong", "sha256=00"])(
    "rechaza una firma ausente o incorrecta (%s)",
    (signature) => {
      expect(
        verifyKapsoWebhookSignature({
          rawBody: '{"phone_number_id":"phone-1"}',
          secret: "secret",
          signature,
        }),
      ).toBe(false);
    },
  );
});
