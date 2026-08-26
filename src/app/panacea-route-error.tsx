"use client";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

export function PanaceaRouteError({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 items-center py-12">
      <Alert variant="destructive">
        <AlertTitle>No se pudo cargar {title}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{error.message || "Ocurrió un error inesperado."}</span>
          <Button onClick={reset} size="sm" type="button" variant="outline">
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
