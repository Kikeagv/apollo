"use client";

import Link from "next/link";
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

import { TurnstileField } from "./turnstile-field";

type RecoveryStep = "code" | "done" | "request";

export function PasswordRecoveryForm({
  turnstileSiteKey,
}: {
  turnstileSiteKey?: string;
}) {
  const [step, setStep] = useState<RecoveryStep>("request");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const turnstileToken = data.get("turnstileToken");
    setError(undefined);
    setPending(true);
    try {
      if (typeof turnstileToken !== "string" || turnstileToken === "") {
        setError("Complete la verificación de seguridad.");
        return;
      }
      const requestedEmail = data.get("email");
      if (typeof requestedEmail !== "string" || requestedEmail === "") {
        setError("Ingrese un correo válido.");
        return;
      }
      const response = await fetch(
        "/api/clinic-access/request-password-reset",
        {
          body: JSON.stringify({ email: requestedEmail, turnstileToken }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        setError(
          result.error ??
            (response.status === 429
              ? "Demasiadas solicitudes. Intente de nuevo en 15 minutos."
              : "No se pudo enviar el código."),
        );
        return;
      }
      setEmail(requestedEmail);
      setStep("code");
    } catch {
      setError("No se pudo enviar el código.");
    } finally {
      setPending(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = data.get("password");
    if (typeof password !== "string") {
      setError("Ingrese una contraseña.");
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const otp = data.get("otp");
      if (typeof otp !== "string" || otp === "") {
        setError("Ingrese el código de verificación.");
        return;
      }
      if (password !== data.get("passwordConfirmation")) {
        setError("Las contraseñas no coinciden.");
        return;
      }
      const response = await fetch("/api/clinic-access/reset-password", {
        body: JSON.stringify({
          email,
          otp,
          password,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        setError(result.error ?? "No se pudo restablecer la contraseña.");
        return;
      }
      setStep("done");
    } catch {
      setError("No se pudo restablecer la contraseña.");
    } finally {
      setPending(false);
    }
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <AlertTitle>Contraseña restablecida</AlertTitle>
          <AlertDescription className="text-emerald-900">
            Sus sesiones y dispositivos confiables quedaron revocados; inicie
            sesión de nuevo.
          </AlertDescription>
        </Alert>
        <Link
          className="text-primary decoration-primary/40 hover:decoration-primary focus-visible:ring-ring/30 inline-flex min-h-10 items-center rounded-lg font-medium underline underline-offset-4 transition-colors focus-visible:ring-3 focus-visible:outline-none"
          href="/"
        >
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form
        aria-busy={pending}
        className="space-y-6"
        key="recovery-code"
        onSubmit={resetPassword}
      >
        <p className="text-muted-foreground text-sm leading-6 text-pretty">
          Si el correo corresponde a una Identidad, recibirá un código de un
          solo uso. Ingrese el código y su nueva contraseña.
        </p>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="recovery-otp">
              Código de verificación
            </FieldLabel>
            <FieldContent>
              <Input
                autoCapitalize="off"
                autoComplete="one-time-code"
                autoCorrect="off"
                data-1p-ignore
                data-form-type="other"
                data-lpignore="true"
                id="recovery-otp"
                inputMode="numeric"
                maxLength={12}
                name="otp"
                required
                spellCheck={false}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel htmlFor="recovery-password">
              Nueva contraseña
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                id="recovery-password"
                minLength={8}
                name="password"
                required
                type="password"
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel htmlFor="recovery-password-confirmation">
              Repita la contraseña
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="new-password"
                id="recovery-password-confirmation"
                minLength={8}
                name="passwordConfirmation"
                required
                type="password"
              />
            </FieldContent>
          </Field>
        </FieldGroup>
        <Button disabled={pending} type="submit">
          {pending ? "Restableciendo…" : "Restablecer contraseña"}
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>No se pudo restablecer la contraseña</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </form>
    );
  }

  return (
    <form
      aria-busy={pending}
      className="space-y-6"
      key="recovery-request"
      onSubmit={requestCode}
    >
      <p className="text-muted-foreground text-sm leading-6 text-pretty">
        Ingrese el correo de su Identidad. Enviaremos un código para restablecer
        la contraseña.
      </p>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="recovery-email">Correo</FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              id="recovery-email"
              name="email"
              required
              type="email"
            />
          </FieldContent>
        </Field>
      </FieldGroup>
      <TurnstileField siteKey={turnstileSiteKey} />
      <Button disabled={pending} type="submit">
        {pending ? "Enviando…" : "Enviar código"}
      </Button>
      <p>
        <Link
          className="text-primary decoration-primary/40 hover:decoration-primary focus-visible:ring-ring/30 text-sm font-medium underline underline-offset-4 transition-colors focus-visible:rounded-sm focus-visible:ring-3 focus-visible:outline-none"
          href="/"
        >
          Volver a iniciar sesión
        </Link>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo enviar el código</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
