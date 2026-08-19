import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createClinicSession,
  findTrustedDeviceClinicContext,
  recordClinicLoginAudit,
  recordIdentitySecurityAudit,
  sendClinicLoginOtp,
  CLINIC_TRUSTED_DEVICE_COOKIE,
} from "~/server/application/clinic-access";
import {
  findPasswordBlock,
  registerPasswordFailure,
} from "~/server/application/identity-password-block";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { drizzleIdentityPasswordBlockStore } from "~/server/db/identity-password-block-store";
import { user as identities } from "~/server/db/schema";
import { identityEmailSender } from "~/server/email/identity-email";
import { copySetCookies, readCookie, setClinicSessionCookie } from "../cookies";

const signInInput = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = signInInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Credenciales inválidas" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const identity = await db.query.user.findFirst({
    columns: { id: true },
    where: eq(identities.email, email),
  });

  if (identity !== undefined) {
    const block = await findPasswordBlock(
      { identityId: identity.id },
      drizzleIdentityPasswordBlockStore,
    );
    if (block !== undefined) {
      await recordClinicLoginAudit({
        identityId: identity.id,
        result: "failed",
      });
      return NextResponse.json(
        { error: "Demasiados intentos. Espere 15 minutos e intente de nuevo." },
        { status: 423 },
      );
    }
  }

  const authResponse = await auth.handler(
    new Request(new URL("/api/auth/sign-in/email", request.url), {
      body: JSON.stringify({ ...parsed.data, email }),
      headers: new Headers({
        "content-type": "application/json",
        origin: new URL(request.url).origin,
      }),
      method: "POST",
    }),
  );
  if (!authResponse.ok) {
    if (identity !== undefined) {
      const blocked = await registerPasswordFailure(
        { email, identityId: identity.id },
        {
          sendBlockNotice: async (recipient) => {
            try {
              await identityEmailSender().sendPasswordBlockNotice(recipient);
            } catch {
              // El Bloqueo temporal queda activo aunque el aviso no salga.
            }
          },
          store: drizzleIdentityPasswordBlockStore,
        },
      );
      if (blocked) {
        await recordIdentitySecurityAudit({
          action: "identity-login-blocked",
          identityId: identity.id,
          result: "succeeded",
        });
      }
    }
    await recordClinicLoginAudit({
      identityId: identity?.id,
      result: "failed",
    });
    return NextResponse.json(
      { error: "Credenciales inválidas" },
      { status: 401 },
    );
  }

  const signedIn = (await authResponse.json()) as { user: { id: string } };
  await drizzleIdentityPasswordBlockStore.clearFailures(signedIn.user.id);
  const context = await findTrustedDeviceClinicContext({
    identityId: signedIn.user.id,
    trustedDeviceToken: readCookie(
      request.headers,
      CLINIC_TRUSTED_DEVICE_COOKIE,
    ),
  });

  if (context !== undefined) {
    await recordClinicLoginAudit({
      identityId: signedIn.user.id,
      result: "succeeded",
    });
    const response = NextResponse.json({ status: "authenticated" as const });
    setClinicSessionCookie(
      response,
      await createClinicSession(signedIn.user.id),
    );
    copySetCookies(authResponse, response);
    return response;
  }

  try {
    await sendClinicLoginOtp(signedIn.user.id, email);
  } catch {
    await recordClinicLoginAudit({
      identityId: signedIn.user.id,
      result: "failed",
    });
    const response = NextResponse.json(
      { error: "No tiene acceso a una Clínica activa" },
      { status: 403 },
    );
    copySetCookies(authResponse, response);
    return response;
  }

  const response = NextResponse.json({ status: "otp-required" as const });
  copySetCookies(authResponse, response);
  return response;
}
