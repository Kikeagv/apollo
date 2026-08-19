import { NextResponse } from "next/server";
import { z } from "zod";

import { requestIdentityPasswordReset } from "~/server/application/identity-recovery";
import { auth } from "~/server/better-auth";
import { drizzleIdentityRecoveryRequestStore } from "~/server/db/identity-recovery-store";
import { env } from "~/env";
import { turnstileVerifier } from "~/server/integrations/turnstile";

const requestPasswordResetInput = z.object({
  email: z.string().trim().email(),
  turnstileToken: z.string().min(1).max(4096),
});

export async function POST(request: Request) {
  const parsed = requestPasswordResetInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const result = await requestIdentityPasswordReset(
    {
      email: parsed.data.email,
      ip: requestIp(request),
      turnstileToken: parsed.data.turnstileToken,
    },
    {
      sendResetOtp: async (email) => {
        await auth.api.sendVerificationOTP({
          body: { email, type: "forget-password" },
          headers: new Headers({ origin: env.BETTER_AUTH_URL }),
        });
      },
      store: drizzleIdentityRecoveryRequestStore,
      verifyTurnstile: async ({ token, ip }) =>
        (await turnstileVerifier().verify({ token, ip })).ok,
    },
  );

  if (result === "turnstile-rejected") {
    return NextResponse.json(
      { error: "Verificación fallida. Recargue e intente de nuevo." },
      { status: 400 },
    );
  }
  if (result === "rate-limited") {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intente de nuevo en 15 minutos." },
      { status: 429 },
    );
  }
  // Respuesta idéntica exista o no la Identidad: no se revela el correo.
  return NextResponse.json({ status: "sent" as const });
}

function requestIp(request: Request) {
  // Cloudflare fija CF-Connecting-IP en el borde y el cliente no puede
  // falsearlo; detrás del tunnel no llega tráfico directo a la aplicación.
  const cloudflare = request.headers.get("cf-connecting-ip");
  if (cloudflare !== null && cloudflare !== "") return cloudflare.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) return forwarded.split(",", 1)[0]!.trim();
  return "127.0.0.1";
}
