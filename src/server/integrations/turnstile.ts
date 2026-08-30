import { createHash } from "node:crypto";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { env } from "~/env";

export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Token que emite el formulario solo cuando no hay clave de sitio (desarrollo
 * y pruebas). El verificador simulado acepta únicamente este token exacto;
 * ante cualquier otro valor falla cerrado.
 */
export const SIMULATED_TURNSTILE_PASS_TOKEN = "simulated-turnstile-token";

/**
 * Puerto de verificación Turnstile. El modo simulado acepta únicamente un
 * token fijo de desarrollo; Cloudflare valida contra siteverify con la clave
 * secreta que vive solo en Coolify.
 */
export type TurnstileVerifier = {
  verify(input: { token: string; ip?: string }): Promise<{ ok: boolean }>;
};

/** El piloto no permite Turnstile simulado en producción: falla al arrancar. */
export function assertTurnstileVerificationAllowed(input: {
  nodeEnv: string;
  verification: string;
}) {
  if (input.nodeEnv === "production" && input.verification === "simulated") {
    throw new Error(
      "TURNSTILE_VERIFICATION=simulated no está permitido en producción; configure cloudflare",
    );
  }
}

if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
  assertTurnstileVerificationAllowed({
    nodeEnv: env.NODE_ENV,
    verification: env.TURNSTILE_VERIFICATION,
  });
}

export function turnstileVerifier(): TurnstileVerifier {
  const adapters = {
    simulated: () => createSimulatedTurnstileVerifier(),
    cloudflare: () =>
      createCloudflareTurnstileVerifier({
        secretKey: env.TURNSTILE_SECRET_KEY,
      }),
  } satisfies Record<
    typeof env.TURNSTILE_VERIFICATION,
    () => TurnstileVerifier
  >;
  return adapters[env.TURNSTILE_VERIFICATION]();
}

export function createSimulatedTurnstileVerifier(): TurnstileVerifier {
  return {
    async verify({ token }) {
      return { ok: token === SIMULATED_TURNSTILE_PASS_TOKEN };
    },
  };
}

export function createCloudflareTurnstileVerifier(input: {
  secretKey?: string;
}): TurnstileVerifier {
  if (input.secretKey === undefined || input.secretKey === "") {
    throw new Error(
      "TURNSTILE_SECRET_KEY es obligatoria para validar Turnstile con Cloudflare",
    );
  }
  const secretKey = input.secretKey;

  return {
    async verify({ token, ip }) {
      const body = new URLSearchParams({
        idempotency_key: createHash("sha256")
          .update(`${token}:${ip ?? ""}`)
          .digest("hex"),
        response: token,
        secret: secretKey,
      });
      if (ip !== undefined) body.set("remoteip", ip);
      const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      if (!response.ok) return { ok: false };
      const result = (await response.json()) as { success?: boolean };
      return { ok: result.success === true };
    },
  };
}
