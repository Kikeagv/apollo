"use client";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

type QueryError = { message: string };

export function PanaceaQueryLoading({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="space-y-3"
      role="status"
    >
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-full max-w-xl" />
    </div>
  );
}

export function PanaceaQueryError({
  error,
  onRetry,
  title,
}: {
  error: QueryError;
  onRetry: () => void;
  title: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>No se pudo cargar {title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{error.message}</span>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}
