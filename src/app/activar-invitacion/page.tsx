import { ActivateInvitationForm } from "../activate-invitation-form";

export default async function ActivateInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-medium tracking-[0.2em] text-teal-300">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold">Activar invitación</h1>
        {token ? (
          <ActivateInvitationForm token={token} />
        ) : (
          <p className="text-sm text-rose-300">
            El enlace de activación no es válido o está incompleto.
          </p>
        )}
      </section>
    </main>
  );
}
