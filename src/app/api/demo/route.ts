import { NextResponse } from "next/server";

import { env } from "~/env";
import {
  submitDemoRequest,
  type DemoRequestDependencies,
  type DemoRequestResult,
} from "~/server/application/demo-request";
import { demoRequestEmailSender } from "~/server/email/demo-request-email";
import { drizzleDemoRequestRateLimitStore } from "~/server/db/demo-request-rate-limit-store";
import { turnstileVerifier } from "~/server/integrations/turnstile";

const DEMO_EMAIL_FALLBACK =
  "mailto:contact@enriqueagv.com?subject=Solicitud%20de%20demo%20de%20Praxia";

type DemoRequestRouteDependencies = DemoRequestDependencies & {
  publicSiteUrl: string;
};

const defaultDependencies = (): DemoRequestRouteDependencies => ({
  deliveryFailed: (failure) => {
    console.error("No se pudo entregar una Solicitud de demo", {
      code: "demo-request-email-delivery-failed",
      ...failure,
    });
  },
  ip: "127.0.0.1",
  publicSiteUrl: env.PUBLIC_SITE_URL,
  rateLimitStore: drizzleDemoRequestRateLimitStore,
  sendDemoEmail: (request) => demoRequestEmailSender().sendDemoRequest(request),
  verifyTurnstile: async ({ ip, token }) =>
    (await turnstileVerifier().verify({ ip, token })).ok,
});

export async function POST(request: Request) {
  return handleDemoRequest(request, {
    ...defaultDependencies(),
    ip: requestIp(request),
  });
}

/** Adaptador HTTP testeable para el formulario nativo de la landing. */
export async function handleDemoRequest(
  request: Request,
  dependencies: Omit<DemoRequestRouteDependencies, "ip"> & { ip?: string },
) {
  const input = await formDataInput(request);
  if (input === undefined) return demoErrorResponse("invalid", 400);

  const result = await submitDemoRequest(input, {
    ...dependencies,
    ip: dependencies.ip ?? requestIp(request),
  });
  return responseForResult(result, dependencies.publicSiteUrl);
}

async function formDataInput(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return undefined;
  }

  const input: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || input[key] !== undefined) {
      return undefined;
    }
    input[key] = value;
  }

  const requestReferrer = request.headers.get("referer");
  if (
    (input.referrer === undefined || input.referrer === "") &&
    requestReferrer !== null
  ) {
    input.referrer = requestReferrer;
  }
  return input;
}

function responseForResult(result: DemoRequestResult, publicSiteUrl: string) {
  if (result.status === "accepted") {
    return NextResponse.redirect(new URL("/demo/recibido", publicSiteUrl), 303);
  }
  if (result.status === "rate-limited") {
    return demoErrorResponse("rate-limited", 429);
  }
  if (result.status === "delivery-failed") {
    return demoErrorResponse("delivery-failed", 503);
  }
  return demoErrorResponse(result.status, 400);
}

function demoErrorResponse(
  reason:
    | "delivery-failed"
    | "honeypot-rejected"
    | "invalid"
    | "rate-limited"
    | "turnstile-rejected",
  status: number,
) {
  const message =
    reason === "rate-limited"
      ? "Recibimos demasiadas solicitudes desde este origen. Intenta de nuevo más tarde."
      : reason === "delivery-failed"
        ? "No pudimos entregar tu solicitud en este momento. Puedes escribirnos directamente al correo comercial."
        : reason === "turnstile-rejected"
          ? "No pudimos comprobar la verificación. Recarga la página e intenta de nuevo."
          : "Revisa los campos del formulario e intenta de nuevo.";
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>No pudimos enviar la solicitud | Praxia</title>
  </head>
  <body>
    <main aria-labelledby="error-title">
      <p>Praxia</p>
      <h1 id="error-title">No pudimos enviar la solicitud</h1>
      <p role="alert">${message}</p>
      <p><a href="${DEMO_EMAIL_FALLBACK}">Escribir a contact@enriqueagv.com</a></p>
      <p><a href="https://www.usepraxia.com/demo">Volver al formulario</a></p>
    </main>
  </body>
</html>`;
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status,
  });
}

function requestIp(request: Request) {
  const cloudflare = request.headers.get("cf-connecting-ip");
  if (cloudflare !== null && cloudflare.trim() !== "") return cloudflare.trim();
  // El endpoint está detrás del perímetro de Cloudflare. Sin esa cabecera
  // no confiamos en valores de forwarding enviados directamente por el cliente.
  return "127.0.0.1";
}
