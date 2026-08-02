import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CLINIC_TRUSTED_DEVICE_COOKIE,
  recordClinicLoginAudit,
  verifyClinicLoginOtp,
} from "~/server/application/clinic-access";
import { auth } from "~/server/better-auth";
import { setClinicSessionCookie } from "../cookies";

const verifyOtpInput = z.object({ otp: z.string().trim().min(1).max(12) });

export async function POST(request: Request) {
  const parsed = verifyOtpInput.safeParse(await request.json());
  if (!parsed.success) {
    await recordClinicLoginAudit({ result: "failed" });
    return NextResponse.json({ error: "OTP inválido" }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (session === null) {
    await recordClinicLoginAudit({ result: "failed" });
    return NextResponse.json(
      { error: "Inicie sesión de nuevo" },
      { status: 401 },
    );
  }

  try {
    const trustedDevice = await verifyClinicLoginOtp({
      email: session.user.email,
      identityId: session.user.id,
      otp: parsed.data.otp,
    });
    await recordClinicLoginAudit({
      identityId: session.user.id,
      result: "succeeded",
    });

    const response = NextResponse.json({ status: "authenticated" as const });
    response.cookies.set(
      CLINIC_TRUSTED_DEVICE_COOKIE,
      trustedDevice.trustedDevice.token,
      {
        expires: trustedDevice.trustedDevice.expiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    );
    setClinicSessionCookie(response, trustedDevice.clinicSession);
    return response;
  } catch {
    await recordClinicLoginAudit({
      identityId: session.user.id,
      result: "failed",
    });
    return NextResponse.json({ error: "OTP inválido" }, { status: 400 });
  }
}
