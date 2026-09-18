"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

const REDIRECT_TO_LOGIN_DELAY_MS = 3_000;

export function ActivateInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [result, setResult] = useState<string>();
  const [existingIdentity, setExistingIdentity] = useState(false);
  const [activated, setActivated] = useState(false);
  const [requiresSupport, setRequiresSupport] = useState(false);
  const activationMode = api.panacea.getClinicInvitationActivationMode.useQuery(
    { token },
  );
  const activation = api.panacea.acceptClinicInvitation.useMutation({
    onSuccess: (data) => {
      if (!data.active) {
        setActivated(false);
        setExistingIdentity(true);
        setRequiresSupport(true);
        setResult(
          "La invitación es válida, pero esta Identidad ya tiene acceso activo a otra Clínica. Comuníquese con soporte para continuar.",
        );
        return;
      }

      setRequiresSupport(false);
      setActivated(true);
      setExistingIdentity(data.identityStatus === "existing");
      setResult(
        data.identityStatus === "existing"
          ? "La invitación se vinculó a su Identidad existente."
          : "La cuenta se activó. En unos segundos la llevaremos al inicio de sesión.",
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
    if (activationMode.data === undefined) return;

    const data = new FormData(event.currentTarget);
    const password = data.get("password");
    const confirmation = data.get("confirmation");

    if (activationMode.data === "new") {
      if (typeof password !== "string" || password !== confirmation) {
        setResult("Las contraseñas no coinciden.");
        return;
      }
      setResult(undefined);
      activation.mutate({ password, token });
      return;
    }

    if (activationMode.data !== "existing") return;
    setResult(undefined);
    activation.mutate({ token });
  }

  return (
    <div className="space-y-4">
      {activationMode.isLoading ? (
        <p className="text-sm text-slate-300">Validando invitación…</p>
      ) : activationMode.error ? (
        <p className="text-sm text-rose-300" role="alert">
          {activationMode.error.message}
        </p>
      ) : activated || requiresSupport ? null : activationMode.data ===
        "expired" ? (
        <p className="text-sm text-amber-300" role="alert">
          Esta invitación venció. Solicite al equipo de la Clínica que emita una
          nueva invitación.
        </p>
      ) : activationMode.data === undefined ? null : (
        <form className="space-y-4" onSubmit={submit}>
          {activationMode.data === "new" ? (
            <>
              <p className="text-sm text-slate-300">
                Cree la contraseña de su nueva Identidad para activar el acceso
                a la Clínica.
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
            </>
          ) : (
            <p className="text-sm text-slate-300">
              Su correo ya tiene una Identidad. Conservaremos su contraseña
              actual y vincularemos el acceso a la Clínica.
            </p>
          )}
          <button
            className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={activation.isPending || activationMode.data === undefined}
            type="submit"
          >
            {activation.isPending
              ? "Activando…"
              : activationMode.data === "new"
                ? "Activar cuenta"
                : "Vincular acceso"}
          </button>
          {activation.error ? (
            <p className="text-sm text-rose-300">{activation.error.message}</p>
          ) : null}
        </form>
      )}
      {result ? (
        <p
          className={`text-sm ${requiresSupport ? "text-amber-300" : "text-teal-300"}`}
        >
          {result}{" "}
          {existingIdentity && !requiresSupport ? (
            <>
              Inicie sesión con su contraseña actual o{" "}
              <Link className="underline" href="/?recuperar=1">
                recupérela
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
      {activated ? (
        <p className="text-sm">
          Si el inicio de sesión no abre solo,{" "}
          <Link className="text-teal-300 underline" href="/">
            ingrese desde aquí
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
