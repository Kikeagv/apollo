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
        <Button onClick={onRetry} type="button" variant="outline">
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function PanaceaQueryEmpty({
  description,
  onRetry,
  title,
}: {
  description: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <div
      className="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed p-5"
      role="status"
    >
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {description}
        </p>
      </div>
      {onRetry ? (
        <Button onClick={onRetry} type="button" variant="outline">
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
