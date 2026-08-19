import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  PasswordResetError,
  resetIdentityPassword,
} from "~/server/application/identity-recovery";
import {
  recordIdentitySecurityAudit,
  revokeIdentityClinicAccess,
} from "~/server/application/clinic-access";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { user as identities } from "~/server/db/schema";
import { env } from "~/env";

const resetPasswordInput = z.object({
  email: z.string().trim().email(),
  otp: z.string().trim().min(1).max(12),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const parsed = resetPasswordInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Código inválido o contraseña demasiado corta" },
      { status: 400 },
    );
  }

  try {
    await resetIdentityPassword(parsed.data, {
      findIdentityId: async (email) => {
        const identity = await db.query.user.findFirst({
          columns: { id: true },
          where: eq(identities.email, email),
        });
        return identity?.id;
      },
      recordAudit: ({ action, identityId }) =>
        recordIdentitySecurityAudit({
          action,
          identityId,
          result: "succeeded",
        }),
      resetPassword: async (input) => {
        try {
          await auth.api.resetPasswordEmailOTP({
            body: input,
            headers: new Headers({ origin: env.BETTER_AUTH_URL }),
          });
        } catch (error) {
          throw new PasswordResetError("Código inválido o vencido", {
            cause: error,
          });
        }
      },
      revokeClinicAccess: revokeIdentityClinicAccess,
    });
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  return NextResponse.json({ status: "reset" as const });
}
