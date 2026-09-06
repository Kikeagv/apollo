"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

/** Panel mínimo, aislado de Panacea, para pagos, estado y soporte comercial. */
export function ApoloOperations() {
  const [clinicId, setClinicId] = useState("");
  const clinics = api.apolo.listCommercialClinics.useQuery();
  const runtimeDiagnostic = api.apolo.getWhatsAppRuntimeDiagnostic.useQuery();
  const onboarding = api.apolo.getKapsoOnboarding.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const [clinicName, setClinicName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [supportSessionId, setSupportSessionId] = useState("");
  const [onboardingOwnerName, setOnboardingOwnerName] = useState("");
  const [phoneNumberE164, setPhoneNumberE164] = useState("");
  const [numberOwnedByClinic, setNumberOwnedByClinic] = useState(false);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [whatsappBusinessApp, setWhatsappBusinessApp] = useState<
    "active" | "messenger-only" | "not-installed" | "not-willing"
  >("active");
  const [metaAuthority, setMetaAuthority] = useState<
    "confirmed" | "not-confirmed"
  >("not-confirmed");
  const [qrDeviceAvailable, setQrDeviceAvailable] = useState(false);
  const createClinic = api.apolo.createManualClinic.useMutation({
    onSuccess: (clinic) => {
      setClinicId(clinic.id);
      setOnboardingOwnerName(ownerName);
      void clinics.refetch();
    },
  });
  const prepareOnboarding =
    api.apolo.prepareKapsoWhatsAppOnboarding.useMutation({
      onSuccess: () => onboarding.refetch(),
    });
  const recordPayment = api.apolo.recordTransferPayment.useMutation();
  const setSubscription = api.apolo.changeSubscriptionStatus.useMutation({
    onSuccess: () => clinics.refetch(),
  });
  const openSupport = api.apolo.openSupportSession.useMutation({
    onSuccess: (session) => setSupportSessionId(session.id),
  });
  const readSupport = api.apolo.readSupportClinicSummary.useMutation();

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 bg-slate-950 p-8 text-slate-100">
      <div>
        <p className="text-sm font-medium tracking-[0.2em] text-teal-300">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold">Operación comercial</h1>
        <p className="mt-2 text-slate-300">
          Este camino no abre el panel clínico ni concede acceso clínico por sí
          mismo.
        </p>
      </div>
      <section
        aria-labelledby="whatsapp-runtime-title"
        className="space-y-3 rounded-xl border border-slate-700 p-5"
        data-whatsapp-runtime-diagnostic="true"
      >
        <div>
          <h2 className="text-xl font-semibold" id="whatsapp-runtime-title">
            Runtime de WhatsApp
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Diagnóstico de credenciales del proveedor central. No prueba la
            Conexión de WhatsApp de una Clínica; las credenciales nunca se
            muestran ni se guardan por Clínica.
          </p>
        </div>
        {runtimeDiagnostic.isLoading ? (
          <p className="text-sm text-slate-300" role="status">
            Consultando configuración…
          </p>
        ) : runtimeDiagnostic.data ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <DiagnosticValue
              label="Proveedor activo"
              value={
                runtimeDiagnostic.data.provider === "kapso"
                  ? "Kapso"
                  : "Simulado"
              }
            />
            <DiagnosticValue
              label="Estado del runtime"
              value={
                runtimeDiagnostic.data.configured
                  ? "Configurado"
                  : "Requiere configuración"
              }
            />
            <DiagnosticValue
              label="Secretos"
              value={
                runtimeDiagnostic.data.provider === "kapso"
                  ? `${secretStatusLabel(runtimeDiagnostic.data.apiKey)} · ${secretStatusLabel(runtimeDiagnostic.data.webhookSecret)}`
                  : "No requeridos"
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-amber-200" role="status">
            El diagnóstico no está disponible para esta identidad.
          </p>
        )}
      </section>
      <label className="block text-sm">
        Clínica
        <select
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setClinicId(event.target.value)}
          value={clinicId}
        >
          <option value="">Seleccione una Clínica</option>
          {clinics.data?.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name} · {clinic.subscriptionStatus}
            </option>
          ))}
        </select>
      </label>
      <section className="space-y-3 rounded-xl border border-teal-500/70 p-5">
        <div>
          <h2 className="text-xl font-semibold">Alta manual de Clínica</h2>
          <p className="mt-1 text-sm text-slate-300">
            Crea la Clínica y envía la invitación al Médico propietario. El
            customer de Kapso se confirma en el preflight, antes del enlace.
          </p>
        </div>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setClinicName(event.target.value)}
          placeholder="Nombre de la Clínica"
          value={clinicName}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setOwnerName(event.target.value)}
          placeholder="Nombre del Médico propietario"
          value={ownerName}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setOwnerEmail(event.target.value)}
          placeholder="Correo del Médico propietario"
          type="email"
          value={ownerEmail}
        />
        <button
          className="rounded bg-teal-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={
            !clinicName || !ownerName || !ownerEmail || createClinic.isPending
          }
          onClick={() =>
            createClinic.mutate({ clinicName, ownerEmail, ownerName })
          }
          type="button"
        >
          Crear Clínica y enviar invitación
        </button>
        {createClinic.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {createClinic.error.message}
          </p>
        ) : null}
      </section>
      <section className="space-y-3 rounded-xl border border-sky-500/70 p-5">
        <div>
          <h2 className="text-xl font-semibold">Preflight de WhatsApp</h2>
          <p className="mt-1 text-sm text-slate-300">
            Comprueba las condiciones operativas de la Clínica. No se guardan
            OTP, QR, documentos ni credenciales, y este paso no ejecuta acciones
            de Meta por el Médico.
          </p>
        </div>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setOnboardingOwnerName(event.target.value)}
          placeholder="Médico propietario confirmado"
          value={onboardingOwnerName}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setPhoneNumberE164(event.target.value)}
          placeholder="Número propio en formato internacional, por ejemplo +50370000000"
          value={phoneNumberE164}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={ownerConfirmed}
            onChange={(event) => setOwnerConfirmed(event.target.checked)}
            type="checkbox"
          />
          Médico propietario confirmado para este flujo
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={numberOwnedByClinic}
            onChange={(event) => setNumberOwnedByClinic(event.target.checked)}
            type="checkbox"
          />
          El número es propio de la Clínica
        </label>
        <label className="block text-sm">
          WhatsApp instalado en el número
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
            onChange={(event) =>
              setWhatsappBusinessApp(
                event.target.value as
                  "active" | "messenger-only" | "not-installed" | "not-willing",
              )
            }
            value={whatsappBusinessApp}
          >
            <option value="active">WhatsApp Business App activa</option>
            <option value="not-installed">No está instalada</option>
            <option value="messenger-only">Solo WhatsApp Messenger</option>
            <option value="not-willing">
              No desea mantener WhatsApp Business App
            </option>
          </select>
        </label>
        <label className="block text-sm">
          Autoridad Meta
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
            onChange={(event) =>
              setMetaAuthority(
                event.target.value as "confirmed" | "not-confirmed",
              )
            }
            value={metaAuthority}
          >
            <option value="not-confirmed">No confirmada</option>
            <option value="confirmed">Confirmada</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={qrDeviceAvailable}
            onChange={(event) => setQrDeviceAvailable(event.target.checked)}
            type="checkbox"
          />
          Hay un dispositivo para mostrar y completar el QR
        </label>
        <button
          className="rounded bg-sky-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={
            !clinicId ||
            !onboardingOwnerName ||
            !phoneNumberE164 ||
            prepareOnboarding.isPending
          }
          onClick={() =>
            prepareOnboarding.mutate({
              clinicId,
              metaAuthority,
              numberOwnedByClinic,
              ownerConfirmed,
              ownerName: onboardingOwnerName,
              phoneNumberE164,
              qrDeviceAvailable,
              whatsappBusinessApp,
            })
          }
          type="button"
        >
          Confirmar customer y ejecutar preflight
        </button>
        {prepareOnboarding.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {prepareOnboarding.error.message}
          </p>
        ) : null}
        {onboarding.isLoading ? (
          <p className="text-sm text-slate-300" role="status">
            Consultando estado de onboarding…
          </p>
        ) : onboarding.data ? (
          <OnboardingSummary snapshot={onboarding.data} />
        ) : clinicId ? (
          <p className="text-sm text-slate-300">
            Todavía no hay un preflight ejecutado para esta Clínica.
          </p>
        ) : null}
      </section>
      <section className="space-y-3 rounded-xl border border-slate-700 p-5">
        <h2 className="text-xl font-semibold">Pago por transferencia</h2>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setAmountUsd(event.target.value)}
          placeholder="Monto USD, por ejemplo 75.00"
          value={amountUsd}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setReference(event.target.value)}
          placeholder="Referencia de transferencia"
          value={reference}
        />
        <button
          className="rounded bg-teal-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={!clinicId || recordPayment.isPending}
          onClick={() =>
            recordPayment.mutate({ amountUsd, clinicId, reference })
          }
          type="button"
        >
          Registrar pago
        </button>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-700 p-5">
        <h2 className="text-xl font-semibold">Suscripción</h2>
        <div className="flex gap-2">
          <button
            className="rounded border border-teal-300 px-3 py-2 disabled:opacity-50"
            disabled={!clinicId || setSubscription.isPending}
            onClick={() =>
              setSubscription.mutate({ clinicId, status: "active" })
            }
            type="button"
          >
            Activar
          </button>
          <button
            className="rounded border border-amber-400 px-3 py-2 disabled:opacity-50"
            disabled={!clinicId || setSubscription.isPending}
            onClick={() =>
              setSubscription.mutate({ clinicId, status: "suspended" })
            }
            type="button"
          >
            Suspender
          </button>
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-amber-500/70 p-5">
        <h2 className="text-xl font-semibold">Soporte con vencimiento</h2>
        <textarea
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo de soporte"
          value={reason}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setExpiresAt(event.target.value)}
          type="datetime-local"
          value={expiresAt}
        />
        <button
          className="rounded bg-amber-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={!clinicId || !reason || !expiresAt || openSupport.isPending}
          onClick={() =>
            openSupport.mutate({
              clinicId,
              expiresAt: new Date(expiresAt),
              reason,
            })
          }
          type="button"
        >
          Abrir soporte auditado
        </button>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setSupportSessionId(event.target.value)}
          placeholder="ID de sesión de soporte"
          value={supportSessionId}
        />
        <button
          className="rounded border border-amber-300 px-3 py-2 disabled:opacity-50"
          disabled={!clinicId || !supportSessionId || readSupport.isPending}
          onClick={() => readSupport.mutate({ clinicId, supportSessionId })}
          type="button"
        >
          Consultar estado de soporte
        </button>
        {readSupport.data ? (
          <p className="text-sm text-slate-200">
            {readSupport.data.name}: {readSupport.data.subscriptionStatus}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function OnboardingSummary({
  snapshot,
}: {
  snapshot: {
    connection: {
      metadata: Record<string, string | null>;
      phoneNumberE164: string | null;
      phoneNumberId: string | null;
      provider: "simulated" | "kapso";
      status: string;
    } | null;
    customerId: string | null;
    ownerName: string | null;
    preflight: {
      blockers: { message: string; nextAction: string }[];
      nextAction: string;
      reason: string | null;
      status: string;
    } | null;
  };
}) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm">
      <dl className="grid gap-2 sm:grid-cols-3">
        <DiagnosticValue
          label="Customer"
          value={snapshot.customerId ?? "Pendiente de confirmar"}
        />
        <DiagnosticValue
          label="Propietario"
          value={snapshot.ownerName ?? "Pendiente de registrar"}
        />
        <DiagnosticValue
          label="Proveedor"
          value={
            snapshot.connection?.provider === "kapso" ? "Kapso" : "Simulado"
          }
        />
        <DiagnosticValue
          label="Conexión"
          value={onboardingConnectionStatusLabel(
            snapshot.connection?.status ?? "none",
          )}
        />
        <DiagnosticValue
          label="Número"
          value={
            snapshot.connection?.metadata.displayPhoneE164 ??
            snapshot.connection?.phoneNumberE164 ??
            "Pendiente de registrar"
          }
        />
        <DiagnosticValue
          label="Phone number ID"
          value={snapshot.connection?.phoneNumberId ?? "Pendiente"}
        />
      </dl>
      {snapshot.preflight ? (
        <>
          <p>
            Estado del preflight:{" "}
            <strong>{preflightStatusLabel(snapshot.preflight.status)}</strong>
          </p>
          {snapshot.preflight.reason ? (
            <p className="text-amber-200">{snapshot.preflight.reason}</p>
          ) : null}
          {snapshot.preflight.blockers.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-amber-200">
              {snapshot.preflight.blockers.map((blocker) => (
                <li key={`${blocker.message}-${blocker.nextAction}`}>
                  {blocker.message} {blocker.nextAction}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-teal-200">
            Siguiente acción: {snapshot.preflight.nextAction}
          </p>
        </>
      ) : null}
    </div>
  );
}

function onboardingConnectionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked: "Bloqueada",
    degraded: "Degradada",
    disconnected: "Desconectada",
    none: "Sin conexión",
    pending: "Pendiente",
    provisioning: "Provisionando",
    ready: "Lista",
  };
  return labels[status] ?? "Estado no disponible";
}

function preflightStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked: "Bloqueado",
    "not-run": "No ejecutado",
    passed: "Sin bloqueos conocidos",
    unavailable: "Kapso no disponible",
  };
  return labels[status] ?? "Estado no disponible";
}

function DiagnosticValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <dt className="text-xs tracking-wide text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function secretStatusLabel(
  status: "configured" | "not-configured" | "not-required",
) {
  if (status === "configured") return "Configurado";
  if (status === "not-configured") return "Ausente";
  return "No requerida";
}
