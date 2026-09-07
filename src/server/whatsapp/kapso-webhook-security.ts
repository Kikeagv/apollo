import { createHmac, timingSafeEqual } from "node:crypto";

export function createKapsoWebhookSignature(rawBody: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyKapsoWebhookSignature(input: {
  rawBody: string;
  secret: string;
  signature: string | null | undefined;
}) {
  if (input.signature === undefined || input.signature === null) return false;

  const candidate = input.signature.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;

  const expected = createHmac("sha256", input.secret)
    .update(input.rawBody)
    .digest("hex");
  const candidateBytes = Buffer.from(candidate, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}
