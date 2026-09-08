"use client";

import { useState } from "react";

import {
  whatsappSetupLinkStatus,
  whatsappSetupLinkStatusLabel,
  type WhatsAppSetupLink,
} from "~/domain/whatsapp-setup-link";
import { formatDateTime } from "~/app/format-date";
import {
  setupLinkActionLabel,
  setupLinkNextActionLabel,
  setupLinkProviderStatusLabel,
} from "~/app/whatsapp-setup-link-presentation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
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
  const readiness = api.apolo.getWhatsAppReadiness.useQuery(
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
  const manageSetupLink = api.apolo.manageKapsoWhatsAppSetupLink.useMutation({
    onSuccess: () => onboarding.refetch(),
  });
  const retryReadiness = api.apolo.retryWhatsAppReadiness.useMutation({
    onSuccess: () => void readiness.refetch(),
    onError: () => void readiness.refetch(),
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
          <>
            <OnboardingSummary snapshot={onboarding.data} />
            <SetupLinkOperations
              clinicId={clinicId}
              isPending={manageSetupLink.isPending}
              onManage={(action, actionReason) =>
                manageSetupLink.mutate({
                  action,
                  clinicId,
                  ...(actionReason === undefined
                    ? {}
                    : { reason: actionReason }),
                })
              }
              snapshot={onboarding.data}
            />
            {manageSetupLink.error ? (
              <p className="text-sm text-amber-200" role="alert">
                {manageSetupLink.error.message}
              </p>
            ) : null}
          </>
        ) : clinicId ? (
          <p className="text-sm text-slate-300">
            Todavía no hay un preflight ejecutado para esta Clínica.
          </p>
        ) : null}
      </section>
      <section
        aria-labelledby="whatsapp-readiness-title"
        className="space-y-4 rounded-xl border border-violet-500/70 p-5"
        data-whatsapp-readiness-operations="true"
      >
        <div>
          <h2 className="text-xl font-semibold" id="whatsapp-readiness-title">
            Readiness técnico de WhatsApp
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Solo una Conexión con número, webhooks, plantillas, billing y E2E
            correctos pasa a <code>ready</code>. Estos gates no autorizan datos
            reales ni sustituyen Consentimiento, privacidad o el gate legal.
          </p>
        </div>
        {!clinicId ? (
          <p className="text-sm text-slate-400">
            Seleccione una Clínica para consultar sus gates.
          </p>
        ) : readiness.isLoading ? (
          <p className="text-sm text-slate-300" role="status">
            Consultando readiness…
          </p>
        ) : readiness.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {readiness.error.message}
          </p>
        ) : readiness.data?.connection === null ? (
          <p className="text-sm text-slate-300">
            La Clínica todavía no tiene una Conexión de WhatsApp. Complete el
            enlace de configuración antes de reintentar readiness.
          </p>
        ) : readiness.data ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <DiagnosticValue
                label="Estado técnico"
                value={apoloReadinessStatusLabel(
                  readiness.data.readiness.status,
                )}
              />
              <DiagnosticValue
                label="Entorno del número"
                value={readiness.data.numberEnvironment}
              />
              <DiagnosticValue
                label="Salud del número"
                value={readiness.data.numberHealth}
              />
              <DiagnosticValue
                label="Última prueba E2E"
                value={
                  readiness.data.e2e.lastTestAt === null
                    ? "Sin evidencia"
                    : formatDateTime(readiness.data.e2e.lastTestAt)
                }
              />
            </dl>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <p className="font-medium">Billing atribuido</p>
                <dl className="mt-2 space-y-1 text-slate-300">
                  <div>
                    <dt className="inline">Modo: </dt>
                    <dd className="inline">{readiness.data.billing.mode}</dd>
                  </div>
                  <div>
                    <dt className="inline">Crédito: </dt>
                    <dd className="inline">
                      {formatCents(readiness.data.billing.creditCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Consumo: </dt>
                    <dd className="inline">
                      {formatCents(readiness.data.billing.consumedCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Umbral de alerta: </dt>
                    <dd className="inline">
                      {readiness.data.billing.alertThresholdCents === null
                        ? "No registrado"
                        : formatCents(
                            readiness.data.billing.alertThresholdCents,
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Cargos separados: </dt>
                    <dd className="inline">
                      {readiness.data.billing.chargesSeparated ? "Sí" : "No"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Cargos de Meta: </dt>
                    <dd className="inline">
                      {readiness.data.billing.metaChargesCents == null
                        ? "No registrados"
                        : formatCents(readiness.data.billing.metaChargesCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Cargos de plataforma: </dt>
                    <dd className="inline">
                      {readiness.data.billing.platformChargesCents == null
                        ? "No registrados"
                        : formatCents(
                            readiness.data.billing.platformChargesCents,
                          )}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <p className="font-medium">Plantillas críticas</p>
                <ul className="mt-2 space-y-1 text-slate-300">
                  {readiness.data.templates.map((template) => (
                    <li key={template.kind}>
                      {template.name} · {template.locale || "sin locale"} ·{" "}
                      {template.category ?? "sin categoría"} · {template.status}
                      {template.rejectionReason
                        ? ` · ${template.rejectionReason}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <ul className="space-y-3" data-whatsapp-readiness-gates="true">
              {readiness.data.readiness.gates.map((gate) => (
                <li
                  className="rounded-lg border border-slate-700 bg-slate-900/60 p-3"
                  key={gate.code}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {apoloReadinessGateLabel(gate.code)}
                    </span>
                    <span className="text-xs tracking-wide text-slate-300 uppercase">
                      {gate.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{gate.message}</p>
                  {gate.code === "templates" ||
                  gate.code === "billing" ||
                  gate.code === "e2e" ||
                  (gate.code === "number" &&
                    (readiness.data.connection?.status === "blocked" ||
                      readiness.data.connection?.status === "degraded")) ||
                  gate.action ===
                    "Reactivar manualmente la Conexión de WhatsApp" ? (
                    <button
                      className="mt-3 rounded border border-violet-300 px-3 py-2 text-sm text-violet-100 disabled:opacity-50"
                      disabled={retryReadiness.isPending}
                      onClick={() =>
                        retryReadiness.mutate({
                          action:
                            gate.code === "templates"
                              ? "templates"
                              : gate.code === "billing"
                                ? "billing"
                                : gate.code === "e2e"
                                  ? "e2e"
                                  : "reactivate",
                          clinicId,
                        })
                      }
                      type="button"
                    >
                      {apoloReadinessActionLabel(
                        gate.code === "templates"
                          ? "templates"
                          : gate.code === "billing"
                            ? "billing"
                            : gate.code === "e2e"
                              ? "e2e"
                              : "reactivate",
                      )}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="rounded-lg border border-amber-500/60 bg-amber-950/30 p-3 text-sm text-amber-100">
              {readiness.data.readiness.legalAuthorization.message}
            </p>
            {retryReadiness.error ? (
              <p className="text-sm text-amber-200" role="alert">
                {retryReadiness.error.message}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-300">
            La Clínica todavía no tiene una Conexión de WhatsApp.
          </p>
        )}
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
        <DiagnosticValue
          label="WABA / business account"
          value={snapshot.connection?.metadata.businessAccountId ?? "Pendiente"}
        />
      </dl>
      {snapshot.connection?.metadata.statusReason ? (
        <p className="text-amber-200">
          Estado: {snapshot.connection.metadata.statusReason}
        </p>
      ) : null}
      {snapshot.connection?.metadata.nextAction ? (
        <p className="text-teal-200">
          Siguiente acción: {snapshot.connection.metadata.nextAction}
        </p>
      ) : null}
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

function SetupLinkOperations({
  clinicId,
  isPending,
  onManage,
  snapshot,
}: {
  clinicId: string;
  isPending: boolean;
  onManage: (
    action: "generate" | "regenerate" | "revoke",
    reason?: string,
  ) => void;
  snapshot: {
    preflight: { status: string } | null;
    setupLink: WhatsAppSetupLink | null;
    setupLinkProviderError: string | null;
    setupLinkProviderStatus: string | null;
    setupLinkHistory: {
      action: string;
      actorIdentityId: string;
      occurredAt: Date | string;
      reason: string;
    }[];
  };
}) {
  const [pendingAction, setPendingAction] = useState<
    "regenerate" | "revoke" | null
  >(null);
  const [actionReason, setActionReason] = useState("");
  const setupLink = snapshot.setupLink;
  const status = setupLink === null ? null : whatsappSetupLinkStatus(setupLink);
  const preflightPassed = snapshot.preflight?.status === "passed";

  return (
    <section
      aria-labelledby="setup-link-operations-title"
      className="space-y-3 rounded-lg border border-teal-500/70 bg-slate-900/60 p-4 text-sm"
      data-setup-link-operations="true"
    >
      <div>
        <h3 className="font-semibold" id="setup-link-operations-title">
          Enlace de configuración de WhatsApp
        </h3>
        <p className="mt-1 text-slate-300">
          Se entrega únicamente desde esta sesión autenticada. El propietario
          completa OTP, QR, contraseñas y credenciales de Meta; Praxia no los
          recibe ni los guarda.
        </p>
      </div>
      {setupLink !== null && status !== null ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          <DiagnosticValue
            label="Estado del enlace"
            value={whatsappSetupLinkStatusLabel(status)}
          />
          <DiagnosticValue
            label="Vencimiento"
            value={formatSetupLinkDate(setupLink.expiresAt)}
          />
          <DiagnosticValue
            label="Estado remoto"
            value={setupLinkProviderStatusLabel(
              snapshot.setupLinkProviderStatus,
            )}
          />
          <DiagnosticValue
            label="Creado"
            value={formatSetupLinkDate(setupLink.createdAt)}
          />
          <DiagnosticValue
            label="Revocado"
            value={
              setupLink.revokedAt === null
                ? "No"
                : formatSetupLinkDate(setupLink.revokedAt)
            }
          />
          <div className="sm:col-span-2">
            <DiagnosticValue
              label="Siguiente acción"
              value={setupLinkNextActionLabel(
                setupLink,
                snapshot.setupLinkProviderStatus,
                snapshot.setupLinkProviderError,
              )}
            />
          </div>
        </dl>
      ) : (
        <p className="text-slate-300">
          No hay un enlace activo registrado para esta Clínica.
        </p>
      )}
      {snapshot.setupLinkProviderError !== null ? (
        <p className="text-amber-200" role="status">
          {snapshot.setupLinkProviderError}
        </p>
      ) : null}
      {snapshot.setupLinkHistory.length > 0 ? (
        <ol className="space-y-2 text-slate-300">
          {snapshot.setupLinkHistory.map((event, index) => (
            <li key={`${String(event.occurredAt)}-${event.action}-${index}`}>
              {setupLinkActionLabel(event.action)} · {event.reason} ·{" "}
              {formatDateTime(event.occurredAt)} · actor {event.actorIdentityId}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {setupLink !== null && status === "active" ? (
          <>
            <a
              className="rounded border border-teal-300 px-3 py-2 font-medium text-teal-200"
              href={setupLink.url}
              rel="noreferrer"
              target="_blank"
            >
              Abrir enlace
            </a>
            <button
              className="rounded border border-amber-300 px-3 py-2 disabled:opacity-50"
              disabled={!preflightPassed || isPending}
              onClick={() => setPendingAction("revoke")}
              type="button"
            >
              Revocar enlace
            </button>
          </>
        ) : null}
        <button
          className="rounded bg-teal-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={!clinicId || !preflightPassed || isPending}
          onClick={() => {
            if (status === "active") {
              setPendingAction("regenerate");
              return;
            }
            onManage("generate");
          }}
          type="button"
        >
          {status === "active" ? "Regenerar enlace" : "Generar enlace"}
        </button>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setActionReason("");
          }
        }}
        open={pendingAction !== null}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {pendingAction === "revoke"
              ? "¿Revocar el enlace de configuración?"
              : "¿Regenerar el enlace de configuración?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingAction === "revoke"
              ? "El enlace dejará de ser utilizable y la Clínica tendrá que generar otro para continuar."
              : "El enlace actual se revocará antes de crear uno nuevo. El propietario deberá completar el nuevo enlace."}
          </AlertDialogDescription>
          <label className="mt-3 block text-sm">
            Motivo (opcional)
            <textarea
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
              onChange={(event) => setActionReason(event.target.value)}
              value={actionReason}
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => {
                if (pendingAction === null) return;
                onManage(pendingAction, actionReason.trim() || undefined);
                setPendingAction(null);
                setActionReason("");
              }}
            >
              {isPending ? "Procesando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function formatSetupLinkDate(value: Date | string | null) {
  if (value === null) return "No registrado";
  return formatDateTime(value);
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

function apoloReadinessStatusLabel(
  status: "pending" | "ready" | "degraded" | "blocked",
) {
  return {
    blocked: "Bloqueado",
    degraded: "Degradado",
    pending: "Pendiente",
    ready: "Listo técnicamente",
  }[status];
}

function apoloReadinessGateLabel(
  code: "number" | "webhooks" | "templates" | "billing" | "e2e",
) {
  return {
    billing: "Billing y crédito",
    e2e: "Prueba extremo a extremo",
    number: "Número y WABA",
    templates: "Plantillas críticas",
    webhooks: "Webhooks",
  }[code];
}

function apoloReadinessActionLabel(
  action: "templates" | "billing" | "e2e" | "reactivate",
) {
  return {
    billing: "Reintentar billing",
    e2e: "Ejecutar prueba E2E",
    reactivate: "Reactivar conexión",
    templates: "Sincronizar plantillas",
  }[action];
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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
