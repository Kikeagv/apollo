import { type NextResponse } from "next/server";

import { CLINIC_SESSION_COOKIE } from "~/server/application/clinic-access";

export function copySetCookies(from: Response, to: NextResponse) {
  for (const cookie of getSetCookies(from.headers)) {
    to.headers.append("set-cookie", cookie);
  }
}

export function readCookie(headers: Headers, name: string) {
  const cookie = headers.get("cookie");
  return cookie
    ?.split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([key]) => key === name)?.[1];
}

export function setClinicSessionCookie(
  response: NextResponse,
  session: { expiresAt: Date; token: string },
) {
  response.cookies.set(CLINIC_SESSION_COOKIE, session.token, {
    expires: session.expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function getSetCookies(headers: Headers) {
  const supportedHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  return (
    supportedHeaders.getSetCookie?.() ??
    [headers.get("set-cookie")].filter(
      (cookie): cookie is string => cookie !== null,
    )
  );
}
