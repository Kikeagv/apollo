import { NextResponse } from "next/server";

import {
  CLINIC_SESSION_COOKIE,
  CLINIC_TRUSTED_DEVICE_COOKIE,
  recordClinicLoginAudit,
  renewClinicSession,
} from "~/server/application/clinic-access";
import { auth } from "~/server/better-auth";
import { copySetCookies, readCookie, setClinicSessionCookie } from "../cookies";

export async function POST(request: Request) {
  const authResponse = await auth.handler(
    new Request(new URL("/api/auth/get-session", request.url), {
      headers: request.headers,
      method: "GET",
    }),
  );
  const session = authResponse.ok
    ? ((await authResponse.json()) as { user?: { id: string } } | null)
    : null;
  if (session?.user === undefined) {
    await recordClinicLoginAudit({ result: "failed" });
    return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
  }

  const clinicSession = await renewClinicSession({
    clinicSessionToken: readCookie(request.headers, CLINIC_SESSION_COOKIE),
    identityId: session.user.id,
    trustedDeviceToken: readCookie(
      request.headers,
      CLINIC_TRUSTED_DEVICE_COOKIE,
    ),
  });
  if (clinicSession === undefined) {
    await recordClinicLoginAudit({
      identityId: session.user.id,
      result: "failed",
    });
    return NextResponse.json(
      { error: "Acceso clínico no disponible" },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ status: "active" as const });
  copySetCookies(authResponse, response);
  setClinicSessionCookie(response, clinicSession);
  return response;
}
