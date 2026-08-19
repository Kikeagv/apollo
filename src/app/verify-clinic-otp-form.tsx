"use client";

import { type FormEvent, useState } from "react";

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
      window.location.assign("/");
    } catch {
      setError("No se pudo verificar el OTP.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-slate-300">
        Enviamos un código de un solo uso a su correo. Este navegador quedará
        confiable por 30 días.
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
      <button
        className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "Verificando…" : "Verificar y abrir Praxia"}
      </button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </form>
  );
}
