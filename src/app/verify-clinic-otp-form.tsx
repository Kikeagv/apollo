"use client";

import { type FormEvent, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

export function VerifyClinicOtpForm() {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = new FormData(event.currentTarget).get("otp");
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/clinic-access/verify-otp", {
        body: JSON.stringify({ otp }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "El OTP no es válido.");
        return;
      }
      window.location.assign("/calendario");
    } catch {
      setError("No se pudo verificar el OTP.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="space-y-6" onSubmit={submit}>
      <p className="text-muted-foreground text-sm leading-6 text-pretty">
        Enviamos un código de un solo uso a su correo. Este navegador quedará
        confiable por 30 días.
      </p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="clinic-otp">Código de verificación</FieldLabel>
          <FieldContent>
            <Input
              autoCapitalize="off"
              autoComplete="one-time-code"
              autoCorrect="off"
              data-1p-ignore
              data-form-type="other"
              data-lpignore="true"
              id="clinic-otp"
              inputMode="numeric"
              maxLength={12}
              name="otp"
              required
              spellCheck={false}
            />
          </FieldContent>
        </Field>
      </FieldGroup>
      <Button disabled={pending} type="submit">
        {pending ? "Verificando…" : "Verificar y abrir Praxia"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo verificar el código</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
