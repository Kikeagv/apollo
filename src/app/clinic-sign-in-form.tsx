"use client";

import { type FormEvent, useState } from "react";

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
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-slate-300">
        Inicie sesión con el correo y la contraseña de su Identidad.
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
      <label className="block text-sm">
        Contraseña
        <input
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          name="password"
          required
          type="password"
        />
      </label>
      <button
        className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "Iniciando…" : "Iniciar sesión"}
      </button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </form>
  );
}
