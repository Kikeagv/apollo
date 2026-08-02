"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";

export function ActivateInvitationForm({ token }: { token: string }) {
  const [result, setResult] = useState<string>();
  const activation = api.panacea.acceptClinicOwnerInvitation.useMutation({
    onSuccess: () => {
      setResult(
        "La cuenta se activó. Ya puede iniciar sesión con su correo y contraseña.",
      );
    },
  });

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
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-slate-300">
        Cree la contraseña de su Identidad para activar el acceso de médico
        propietario a su Clínica.
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
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {activation.error ? (
        <p className="text-sm text-rose-300">{activation.error.message}</p>
      ) : null}
    </form>
  );
}
