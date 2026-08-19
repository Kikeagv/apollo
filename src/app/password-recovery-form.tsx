"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

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
        <p className="text-sm text-slate-300">
          Contraseña restablecida. Sus sesiones y dispositivos confiables
          quedaron revocados; inicie sesión de nuevo.
        </p>
        <Link
          className="inline-block rounded bg-teal-300 px-4 py-2 font-medium text-slate-950"
          href="/"
        >
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form className="space-y-4" onSubmit={resetPassword}>
        <p className="text-sm text-slate-300">
          Si el correo corresponde a una Identidad, recibirá un código de un
          solo uso. Ingrese el código y su nueva contraseña.
        </p>
        <label className="block text-sm">
          Código de verificación
          <input
            autoCapitalize="off"
            autoComplete="one-time-code"
            autoCorrect="off"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            data-1p-ignore
            data-form-type="other"
            data-lpignore="true"
            inputMode="numeric"
            maxLength={12}
            name="otp"
            required
            spellCheck={false}
          />
        </label>
        <label className="block text-sm">
          Nueva contraseña
          <input
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>
        <label className="block text-sm">
          Repita la contraseña
          <input
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            minLength={8}
            name="passwordConfirmation"
            required
            type="password"
          />
        </label>
        <button
          className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Restableciendo…" : "Restablecer contraseña"}
        </button>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={requestCode}>
      <p className="text-sm text-slate-300">
        Ingrese el correo de su Identidad. Enviaremos un código para restablecer
        la contraseña.
      </p>
      <label className="block text-sm">
        Correo
        <input
          autoComplete="email"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          name="email"
          required
          type="email"
        />
      </label>
      <TurnstileField siteKey={turnstileSiteKey} />
      <button
        className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "Enviando…" : "Enviar código"}
      </button>
      <p>
        <Link className="text-sm text-teal-300 underline" href="/">
          Volver a iniciar sesión
        </Link>
      </p>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </form>
  );
}
