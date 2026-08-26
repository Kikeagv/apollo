"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { activeSupportSessions } from "~/server/application/subscription-support";
import { api } from "~/trpc/react";

/** Hace visible en Panacea toda sesión de soporte de Apolo para la Clínica. */
export function SupportAccessSection() {
  const sessions = api.panacea.listVisibleSupportSessions.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  if (sessions.isLoading) {
    return (
      <div
        aria-busy="true"
        className="text-muted-foreground flex items-center gap-2 text-sm"
        role="status"
      >
        <span
          aria-hidden="true"
          className="bg-primary size-2 rounded-full motion-safe:animate-pulse"
        />
        Comprobando sesiones de soporte…
      </div>
    );
  }

  if (sessions.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No se pudo comprobar el soporte activo</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{sessions.error.message}</span>
          <Button
            onClick={() => void sessions.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const visibleSessions = activeSupportSessions(
    sessions.data ?? [],
    new Date(now),
  );

  if (visibleSessions.length === 0) return null;

  return (
    <Alert
      className="border-amber-300 bg-amber-50 text-amber-950"
      data-support-session-alert="true"
    >
      <ShieldAlert aria-hidden="true" className="text-amber-700" />
      <AlertTitle>Sesión de soporte activa</AlertTitle>
      <AlertDescription className="space-y-3 text-amber-950/80">
        <p>
          Un operador autorizado puede consultar información administrativa de
          esta Clínica. El acceso queda auditado.
        </p>
        <ul className="space-y-2">
          {visibleSessions.map((session) => (
            <li className="border-l-2 border-amber-200 pl-3" key={session.id}>
              <p className="font-medium text-amber-950">{session.reason}</p>
              <p>
                Vence: {formatSupportDate(session.expiresAt)} · Accesos
                auditados: {session.accesses.length}
              </p>
              {session.accesses.length > 0 ? (
                <ul
                  aria-label="Tiempos de acceso auditados"
                  className="list-inside list-disc text-amber-950/70"
                >
                  {session.accesses.map((accessedAt) => (
                    <li key={`${session.id}-${accessedAt.toISOString()}`}>
                      {formatSupportDate(accessedAt)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function formatSupportDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/El_Salvador",
  }).format(new Date(value));
}
