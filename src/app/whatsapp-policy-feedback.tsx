import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

type MutationState = {
  error?: { message: string } | null;
  isPending: boolean;
  isSuccess: boolean;
};

export function WhatsAppPolicyFeedback({
  mutation,
  onRetry,
  successMessage,
}: {
  mutation: MutationState;
  onRetry: () => void;
  successMessage: string;
}) {
  if (!mutation.isPending && !mutation.isSuccess && !mutation.error) {
    return null;
  }

  return (
    <div aria-live="polite" className="space-y-3">
      {mutation.isPending ? (
        <p className="text-muted-foreground text-sm" role="status">
          Guardando…
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <Alert variant="success">
          <AlertTitle>Configuración guardada</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo guardar la configuración</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{mutation.error.message}</span>
            <Button onClick={onRetry} type="button" variant="outline">
              Reintentar guardado
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
