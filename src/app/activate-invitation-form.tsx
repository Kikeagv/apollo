"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

const REDIRECT_TO_LOGIN_DELAY_MS = 3_000;

export function ActivateInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [result, setResult] = useState<string>();
  const [activated, setActivated] = useState(false);
  const activation = api.panacea.acceptClinicInvitation.useMutation({
    onSuccess: () => {
      setActivated(true);
      setResult(
        "La cuenta se activó. En unos segundos la llevaremos al inicio de sesión.",
      );
    },
  });

  useEffect(() => {
    if (!activated) return;
    const timer = window.setTimeout(
      () => router.replace("/"),
      REDIRECT_TO_LOGIN_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activated, router]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = data.get("password");
    const confirmation = data.get("confirmation");

    if (password !== confirmation) {
      setResult("Las contraseñas no coinciden.");
      return;
    }
    setResult(undefined);
    activation.mutate({
      password: typeof password === "string" ? password : "",
      token,
    });
  }

  return (
    <div className="space-y-4">
      {activated ? null : (
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-slate-300">
            Cree la contraseña de su Identidad para activar su acceso a la
            Clínica.
          </p>
          <label className="block text-sm">
            Contraseña
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
            Confirmar contraseña
            <input
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              minLength={8}
              name="confirmation"
              required
              type="password"
            />
          </label>
          <button
            className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={activation.isPending}
            type="submit"
          >
            {activation.isPending ? "Activando…" : "Activar cuenta"}
          </button>
          {activation.error ? (
            <p className="text-sm text-rose-300">
              {activation.error.message}
            </p>
          ) : null}
        </form>
      )}
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {activated ? (
        <p className="text-sm">
          Si el inicio de sesión no abre solo,{" "}
          <a className="text-teal-300 underline" href="/">
            ingrese desde aquí
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
