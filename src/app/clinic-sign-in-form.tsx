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

type SignInResult = {
  error?: string;
  status?: "authenticated" | "otp-required";
};

export function ClinicSignInForm() {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/clinic-access/sign-in", {
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as SignInResult;
      if (!response.ok || result.status === undefined) {
        setError(result.error ?? "No se pudo iniciar sesión.");
        return;
      }
      window.location.assign(
        result.status === "otp-required" ? "/?verificar=otp" : "/",
      );
    } catch {
      setError("No se pudo iniciar sesión.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="space-y-6" onSubmit={submit}>
      <p className="text-muted-foreground text-sm leading-6 text-pretty">
        Inicie sesión con el correo y la contraseña de su Identidad.
      </p>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="sign-in-email">Correo</FieldLabel>
          <FieldContent>
            <Input
              autoComplete="email"
              id="sign-in-email"
              name="email"
              required
              type="email"
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-in-password">Contraseña</FieldLabel>
          <FieldContent>
            <Input
              autoComplete="current-password"
              id="sign-in-password"
              name="password"
              required
              type="password"
            />
          </FieldContent>
        </Field>
      </FieldGroup>
      <Button disabled={pending} type="submit">
        {pending ? "Iniciando…" : "Iniciar sesión"}
      </Button>
      <p className="text-sm">
        <Link
          className="text-primary decoration-primary/40 hover:decoration-primary focus-visible:ring-ring/30 font-medium underline underline-offset-4 transition-colors focus-visible:rounded-sm focus-visible:ring-3 focus-visible:outline-none"
          href="/?recuperar=1"
        >
          ¿Olvidó su contraseña?
        </Link>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo iniciar sesión</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
