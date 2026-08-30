import { env } from "~/env";
import { demoRequestEmailSender } from "~/server/email/demo-request-email";
import { drizzleDemoRequestRateLimitStore } from "~/server/db/demo-request-rate-limit-store";
import { turnstileVerifier } from "~/server/integrations/turnstile";
import {
  handleDemoRequest,
  requestIp,
  type DemoRequestRouteDependencies,
} from "./handler";

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
