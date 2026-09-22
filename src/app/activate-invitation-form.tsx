"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { WHATSAPP_CONFIGURATION_PATH } from "~/domain/whatsapp-setup-link-return";
import { api } from "~/trpc/react";

const REDIRECT_TO_LOGIN_DELAY_MS = 3_000;
const CALENDAR_PATH = "/calendario";

export function ActivateInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [result, setResult] = useState<string>();
  const [existingIdentity, setExistingIdentity] = useState(false);
  const [activated, setActivated] = useState(false);
  const [nextPath, setNextPath] = useState(CALENDAR_PATH);
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
      setNextPath(nextPathForRole(data.role));
      setResult(
        data.role === "owner"
          ? data.identityStatus === "existing"
            ? "La invitación se vinculó a su Identidad existente. Inicie sesión para continuar con la configuración de WhatsApp."
            : "La cuenta se activó. Inicie sesión para continuar con la configuración de WhatsApp."
          : "La cuenta se activó. Inicie sesión para continuar.",
      );
    },
  });

  useEffect(() => {
    if (!activated) return;
    const timer = window.setTimeout(
      () => router.replace(loginPath(nextPath)),
      REDIRECT_TO_LOGIN_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activated, nextPath, router]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activationMode.data === undefined) return;

    const data = new FormData(event.currentTarget);
    const password = data.get("password");
    const confirmation = data.get("confirmation");

    if (activationMode.data.mode === "new") {
      if (typeof password !== "string" || password !== confirmation) {
        setResult("Las contraseñas no coinciden.");
        return;
      }
      setResult(undefined);
      activation.mutate({ password, token });
      return;
    }

    if (activationMode.data.mode !== "existing") return;
    setResult(undefined);
    activation.mutate({ token });
  }

  const activationDetails = activationMode.data;

  return (
    <div className="space-y-4">
      {activationMode.isLoading ? (
        <p className="text-sm text-slate-300">Validando invitación…</p>
      ) : activationMode.error ? (
        <p className="text-sm text-rose-300" role="alert">
          {activationMode.error.message}
        </p>
      ) : activated || requiresSupport ? null : activationDetails?.mode ===
        "expired" ? (
        <p className="text-sm text-amber-300" role="alert">
          Esta invitación venció. Solicite al equipo de la Clínica que emita una
          nueva invitación.
        </p>
      ) : activationDetails?.mode === "accepted" ? (
        <div className="space-y-3 text-sm text-teal-300">
          <p>
            Esta invitación ya fue activada y puede retomarse desde otro
            dispositivo.
          </p>
          <Link
            className="inline-block underline"
            href={loginPath(nextPathForRole(activationDetails.role))}
          >
            Inicie sesión para continuar.
          </Link>
        </div>
      ) : activationDetails === undefined ? null : (
        <form className="space-y-4" onSubmit={submit}>
          {activationDetails.mode === "new" ? (
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
              : activationDetails.mode === "new"
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
          <Link className="text-teal-300 underline" href={loginPath(nextPath)}>
            ingrese desde aquí para continuar
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function nextPathForRole(role: "doctor" | "owner") {
  return role === "owner" ? WHATSAPP_CONFIGURATION_PATH : CALENDAR_PATH;
}

function loginPath(nextPath: string) {
  return `/?next=${encodeURIComponent(nextPath)}`;
}
