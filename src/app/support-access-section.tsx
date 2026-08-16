"use client";

import { api } from "~/trpc/react";

/** Hace visible en Panacea toda sesión de soporte de Apolo para la Clínica. */
export function SupportAccessSection() {
  const sessions = api.panacea.listVisibleSupportSessions.useQuery();

  if (sessions.data?.length === 0) return null;

  return (
    <section className="space-y-2 rounded-xl border border-amber-500/70 bg-amber-950/30 p-5">
      <h2 className="text-xl font-semibold">Soporte de Apolo</h2>
      <p className="text-sm text-slate-200">
        Un operador autorizado puede consultar la información administrativa de
        esta Clínica en la sesión indicada. El acceso queda auditado.
      </p>
      <ul className="space-y-2 text-sm">
        {sessions.data?.map((session) => (
          <li
            className="rounded border border-amber-700/60 p-3"
            key={session.id}
          >
            <p>{session.reason}</p>
            <p className="mt-1 text-slate-300">
              Vence: {new Date(session.expiresAt).toLocaleString("es-SV")}
            </p>
            <p className="mt-1 text-slate-300">
              Accesos auditados: {session.accesses.length}
            </p>
            {session.accesses.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-slate-300">
                {session.accesses.map((accessedAt) => (
                  <li key={accessedAt.toISOString()}>
                    {new Date(accessedAt).toLocaleString("es-SV")}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
