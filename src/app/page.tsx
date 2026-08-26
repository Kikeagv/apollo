import { env } from "~/env";
import { redirect } from "next/navigation";

import { PasswordRecoveryForm } from "./password-recovery-form";
import { ClinicSignInForm } from "./clinic-sign-in-form";
import { VerifyClinicOtpForm } from "./verify-clinic-otp-form";
import { getSession } from "~/server/better-auth/server";
import { getPanaceaSessionContext } from "~/server/application/panacea-shell";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ recuperar?: string; verificar?: string }>;
}) {
  const context = await getPanaceaSessionContext();
  if (context !== undefined) redirect("/calendario");

  const session = await getSession();
  const { recuperar, verificar } = await searchParams;

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
            <VerifyClinicOtpForm />
          </>
        ) : recuperar === "1" ? (
          <PasswordRecoveryForm
            turnstileSiteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          />
        ) : (
          <ClinicSignInForm />
        )}
      </section>
    </main>
  );
}
