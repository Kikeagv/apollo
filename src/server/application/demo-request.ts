import { createHash } from "node:crypto";

import {
  demoRequestFormSchema,
  toDemoRequest,
  type DemoRequest,
} from "~/domain/demo-request";

export const DEMO_REQUEST_WINDOW_MS = 15 * 60 * 1_000;
export const MAX_DEMO_REQUESTS_PER_IP = 5;
export const MAX_DEMO_REQUESTS_PER_EMAIL = 5;

export type DemoRequestRateLimitScope = "email" | "ip";

export type DemoRequestRateLimitStore = {
  countRecent(input: {
    keyHash: string;
    scope: DemoRequestRateLimitScope;
    since: Date;
  }): Promise<number>;
  reserve(input: {
    emailHash: string;
    ipHash: string;
    since: Date;
    requestedAt: Date;
  }): Promise<boolean>;
};

export type DemoRequestDeliveryFailure = {
  errorName: string;
  provider: "resend";
};

export type DemoRequestDependencies = {
  deliveryFailed?(failure: DemoRequestDeliveryFailure): void;
  ip: string;
  rateLimitStore: DemoRequestRateLimitStore;
  sendDemoEmail(request: DemoRequest): Promise<void>;
  verifyTurnstile(input: { ip: string; token: string }): Promise<boolean>;
};

export type DemoRequestResult =
  | { status: "accepted" }
  | { status: "delivery-failed" }
  | { status: "honeypot-rejected" }
  | { status: "invalid" }
  | { status: "rate-limited" }
  | { status: "turnstile-rejected" };

/**
 * Hashea las claves de abuso con un prefijo propio de la Solicitud de demo;
 * la base de datos nunca necesita conservar IP ni correo en claro.
 */
export function hashDemoRequestRateLimitKey(
  scope: DemoRequestRateLimitScope,
  value: string,
) {
  return createHash("sha256")
    .update(`demo-request-${scope}:${value}`)
    .digest("hex");
}

/**
 * Caso de uso público de la Solicitud de demo. El primer efecto permitido es
 * la verificación server-side de Turnstile; el cupo se reserva atómicamente
 * antes de entregar el correo.
 */
export async function submitDemoRequest(
  input: unknown,
  deps: DemoRequestDependencies,
): Promise<DemoRequestResult> {
  const parsed = demoRequestFormSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };

  const { request, turnstileToken, website } = toDemoRequest(parsed.data);
  let turnstileOk = false;
  try {
    turnstileOk = await deps.verifyTurnstile({
      ip: deps.ip,
      token: turnstileToken,
    });
  } catch {
    return { status: "turnstile-rejected" };
  }
  if (!turnstileOk) return { status: "turnstile-rejected" };
  if (website !== "") return { status: "honeypot-rejected" };

  const ipHash = hashDemoRequestRateLimitKey("ip", deps.ip);
  const emailHash = hashDemoRequestRateLimitKey("email", request.email);
  const now = new Date();
  const since = new Date(now.getTime() - DEMO_REQUEST_WINDOW_MS);
  const reserved = await deps.rateLimitStore.reserve({
    emailHash,
    ipHash,
    since,
    requestedAt: now,
  });
  if (!reserved) {
    return { status: "rate-limited" };
  }

  try {
    await deps.sendDemoEmail(request);
  } catch (error) {
    deps.deliveryFailed?.({
      errorName: error instanceof Error ? "Error" : "UnknownError",
      provider: "resend",
    });
    return { status: "delivery-failed" };
  }

  return { status: "accepted" };
}
