import { getSession } from "~/server/better-auth/server";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-medium tracking-[0.2em] text-teal-300">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold">Panacea</h1>
        {session ? (
          <p>
            La Identidad está autenticada. Panacea validará su membresía activa
            antes de abrir el contexto de Clínica.
          </p>
        ) : (
          <p>
            Acceso solo por invitación. Inicie sesión con su correo y
            contraseña.
          </p>
        )}
      </section>
    </main>
  );
}
