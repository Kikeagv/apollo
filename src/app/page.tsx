import { env } from "~/env";
import { WHATSAPP_CONFIGURATION_PATH } from "~/domain/whatsapp-setup-link-return";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PasswordRecoveryForm } from "./password-recovery-form";
import { ClinicSignInForm } from "./clinic-sign-in-form";
import { VerifyClinicOtpForm } from "./verify-clinic-otp-form";
import { getSession } from "~/server/better-auth/server";
import { getPanaceaSessionContext } from "~/server/application/panacea-shell";
import {
  CLINIC_TRUSTED_DEVICE_COOKIE,
  findTrustedSuperadminAccess,
} from "~/server/application/clinic-access";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    recuperar?: string;
    verificar?: string;
  }>;
}) {
  const { next, recuperar, verificar } = await searchParams;
  const nextPath =
    next === WHATSAPP_CONFIGURATION_PATH || next === "/apolo"
      ? next
      : "/calendario";

  const session = await getSession();
  if (session !== null) {
    const cookieStore = await cookies();
    if (
      await findTrustedSuperadminAccess({
        identityId: session.user.id,
        trustedDeviceToken: cookieStore.get(CLINIC_TRUSTED_DEVICE_COOKIE)
          ?.value,
      })
    ) {
      redirect("/apolo");
    }
  }

  const context = await getPanaceaSessionContext();
  if (context !== undefined) redirect(nextPath);

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <section className="border-border bg-card w-full max-w-xl space-y-6 rounded-xl border p-6 shadow-sm sm:p-8">
        <p className="text-primary text-sm font-semibold tracking-[0.16em]">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Praxia
        </h1>
        {session && verificar === "otp" ? (
          <>
            <p>
              Confirme el inicio desde este navegador antes de abrir Praxia.
            </p>
            <VerifyClinicOtpForm nextPath={nextPath} />
          </>
        ) : recuperar === "1" ? (
          <PasswordRecoveryForm
            turnstileSiteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          />
        ) : (
          <ClinicSignInForm nextPath={nextPath} />
        )}
      </section>
    </main>
  );
}
