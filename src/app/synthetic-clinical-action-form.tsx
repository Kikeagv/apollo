"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { api } from "~/trpc/react";

/** Acción de comprobación disponible solo dentro de una Sesión de Clínica. */
export function SyntheticClinicalActionForm() {
  const [message, setMessage] = useState<string>();
  const action = api.panacea.performSyntheticClinicalAction.useMutation({
    onError: () => setMessage("No se pudo registrar la acción clínica."),
    onSuccess: () =>
      setMessage("La acción clínica sintética quedó registrada."),
  });

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-lg font-medium">Comprobación clínica</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Registre una acción sintética para comprobar el aislamiento de esta
            Clínica.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <Button
            disabled={action.isPending}
            onClick={() => action.mutate()}
            type="button"
          >
            {action.isPending ? "Registrando…" : "Registrar acción sintética"}
          </Button>
          {message === undefined ? null : (
            <Alert role="status">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
