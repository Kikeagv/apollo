"use client";

import { useState } from "react";

import {
  whatsappSetupLinkStatus,
  whatsappSetupLinkStatusLabel,
  type WhatsAppSetupLink,
} from "~/domain/whatsapp-setup-link";
import {
  whatsappRealTrafficGateCodes,
  whatsappRealTrafficGateLabel,
  type WhatsAppRealTrafficBlocker,
} from "~/domain/whatsapp-traffic";
import type { WhatsAppOnboardingMode } from "~/domain/whatsapp-preflight";
import { whatsappSyntheticSmokeStepLabels } from "~/domain/whatsapp-smoke";
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
import { WhatsAppActivationClosureSection } from "./whatsapp-activation-closure-section";

/** Panel mínimo, aislado de Panacea, para pagos, estado y soporte comercial. */
export function ApoloOperations() {
  const [clinicId, setClinicId] = useState("");
  const [activationRefreshToken, setActivationRefreshToken] = useState(0);
  const refreshActivationContract = () =>
    setActivationRefreshToken((value) => value + 1);
  const clinics = api.apolo.listCommercialClinics.useQuery();
  const runtimeDiagnostic = api.apolo.getWhatsAppRuntimeDiagnostic.useQuery();
  const inboundAlerts = api.apolo.listWhatsAppInboundAlerts.useQuery();
  const resolveInboundAlert = api.apolo.resolveWhatsAppInboundAlert.useMutation(
    {
      onSuccess: () => void inboundAlerts.refetch(),
    },
  );
  const onboarding = api.apolo.getKapsoOnboarding.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const readiness = api.apolo.getWhatsAppReadiness.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const circuitBreaker = api.apolo.getWhatsAppCircuitBreaker.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const operationalMetrics = api.apolo.getWhatsAppOperationalMetrics.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const whatsappOperations = api.apolo.getWhatsAppOperations.useQuery(
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
  const [onboardingMode, setOnboardingMode] =
    useState<WhatsAppOnboardingMode>("coexistence");
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [whatsappBusinessApp, setWhatsappBusinessApp] = useState<
    "active" | "messenger-only" | "not-installed" | "not-willing"
  >("active");
  const [metaAuthority, setMetaAuthority] = useState<
    "confirmed" | "not-confirmed"
  >("not-confirmed");
  const [qrDeviceAvailable, setQrDeviceAvailable] = useState(false);
  const [causeFixed, setCauseFixed] = useState(false);
  const [manualConfirmation, setManualConfirmation] = useState(false);
  const [realTrafficConfirmation, setRealTrafficConfirmation] = useState(false);
  const [offboardingConfirmation, setOffboardingConfirmation] = useState(false);
  const [gateEvidence, setGateEvidence] = useState<Record<string, string>>({});
  const [openCause, setOpenCause] = useState<
    | "webhook-paused"
    | "high-failure-rate"
    | "credit-exhausted"
    | "quota-exhausted"
    | "provider-error"
    | "meta-error"
    | "legal-block"
  >("provider-error");
  const [openReason, setOpenReason] = useState("");
  const createClinic = api.apolo.createManualClinic.useMutation({
    onSuccess: (clinic) => {
      setClinicId(clinic.id);
      setOnboardingOwnerName(ownerName);
      void clinics.refetch();
    },
  });
  const prepareOnboarding =
    api.apolo.prepareKapsoWhatsAppOnboarding.useMutation({
      onSuccess: () => {
        void onboarding.refetch();
        refreshActivationContract();
      },
    });
  const manageSetupLink = api.apolo.manageKapsoWhatsAppSetupLink.useMutation({
    onSuccess: () => {
      void onboarding.refetch();
      refreshActivationContract();
    },
  });
  const retryReadiness = api.apolo.retryWhatsAppReadiness.useMutation({
    onSuccess: () => {
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
    },
    onError: () => {
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
    },
  });
  const openCircuitBreaker = api.apolo.openWhatsAppCircuitBreaker.useMutation({
    onSuccess: () => {
      setOpenReason("");
      void circuitBreaker.refetch();
      void readiness.refetch();
      refreshActivationContract();
    },
  });
  const reactivateCircuitBreaker =
    api.apolo.reactivateWhatsAppCircuitBreaker.useMutation({
      onSuccess: () => {
        setCauseFixed(false);
        setManualConfirmation(false);
        void circuitBreaker.refetch();
        void readiness.refetch();
        void operationalMetrics.refetch();
        refreshActivationContract();
      },
      onError: () => {
        void circuitBreaker.refetch();
        refreshActivationContract();
      },
    });
  const recordPayment = api.apolo.recordTransferPayment.useMutation();
  const setSubscription = api.apolo.changeSubscriptionStatus.useMutation({
    onSuccess: () => clinics.refetch(),
  });
  const openSupport = api.apolo.openSupportSession.useMutation({
    onSuccess: (session) => setSupportSessionId(session.id),
  });
  const readSupport = api.apolo.readSupportClinicSummary.useMutation();
  const recordTrafficGate = api.apolo.recordWhatsAppTrafficGate.useMutation({
    onSuccess: () => {
      void whatsappOperations.refetch();
      refreshActivationContract();
    },
  });
  const runSyntheticSmoke = api.apolo.runWhatsAppSyntheticSmoke.useMutation({
    onSuccess: () => {
      void whatsappOperations.refetch();
      void readiness.refetch();
      refreshActivationContract();
    },
  });
  const enableRealTraffic = api.apolo.enableWhatsAppRealTraffic.useMutation({
    onSuccess: () => {
      setRealTrafficConfirmation(false);
      void whatsappOperations.refetch();
      void readiness.refetch();
      refreshActivationContract();
    },
  });
  const revertRealTraffic = api.apolo.revertWhatsAppRealTraffic.useMutation({
    onSuccess: () => {
      setRealTrafficConfirmation(false);
      void whatsappOperations.refetch();
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
    },
  });
  const offboardConnection = api.apolo.offboardWhatsAppConnection.useMutation({
    onSuccess: () => {
      setOffboardingConfirmation(false);
      void whatsappOperations.refetch();
      void onboarding.refetch();
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
    },
  });

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
      <section
        aria-labelledby="whatsapp-inbound-alerts-title"
        className="space-y-3 rounded-xl border border-rose-500/70 p-5"
        data-whatsapp-inbound-alerts="true"
      >
        <div>
          <h2
            className="text-xl font-semibold"
            id="whatsapp-inbound-alerts-title"
          >
            Alertas de recepción de WhatsApp
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Eventos rechazados porque no se pudo verificar su Conexión o
            customer. No se asignan automáticamente a ninguna Clínica.
          </p>
        </div>
        {inboundAlerts.isLoading ? (
          <p className="text-sm text-slate-300" role="status">
            Consultando alertas…
          </p>
        ) : inboundAlerts.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {inboundAlerts.error.message}
          </p>
        ) : inboundAlerts.data?.length === 0 ? (
          <p className="text-sm text-slate-400">No hay alertas abiertas.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {inboundAlerts.data?.map((alert) => (
              <li
                className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3"
                key={alert.id}
              >
                <p>{alert.reason}</p>
                <p className="mt-1 text-slate-300">
                  Conexión: <code>{alert.connectionReference}</code> · customer:{" "}
                  <code>{alert.customerReference ?? "no informado"}</code>
                </p>
                <p className="mt-1 text-slate-300">
                  Siguiente acción: {alert.nextAction}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Recibida: {formatDateTime(alert.createdAt)}
                </p>
                <button
                  className="mt-3 rounded bg-rose-300 px-3 py-2 text-xs font-medium text-slate-950 disabled:opacity-50"
                  disabled={resolveInboundAlert.isPending}
                  onClick={() =>
                    resolveInboundAlert.mutate({ alertId: alert.id })
                  }
                  type="button"
                >
                  Corregí la Conexión; reintentar
                </button>
              </li>
            ))}
          </ul>
        )}
        {resolveInboundAlert.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {resolveInboundAlert.error.message}
          </p>
        ) : null}
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
      <section
        aria-labelledby="whatsapp-circuit-breaker-title"
        className="space-y-4 rounded-xl border border-amber-500/70 p-5"
        data-whatsapp-circuit-breaker="true"
      >
        <div>
          <h2
            className="text-xl font-semibold"
            id="whatsapp-circuit-breaker-title"
          >
            Circuit breaker, crédito y métricas
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            El corte es por Clínica. Pausa el agente y la outbox de WhatsApp,
            conserva los eventos pendientes y deja disponible la WhatsApp
            Business App para continuidad manual.
          </p>
        </div>
        {!clinicId ? (
          <p className="text-sm text-slate-400">
            Selecciona una Clínica para consultar su operación.
          </p>
        ) : circuitBreaker.isLoading ? (
          <p className="text-sm text-slate-300" role="status">
            Consultando el circuito…
          </p>
        ) : circuitBreaker.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {circuitBreaker.error.message}
          </p>
        ) : circuitBreaker.data ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <DiagnosticValue
                label="Estado"
                value={
                  circuitBreaker.data.status === "open" ? "Abierto" : "Cerrado"
                }
              />
              <DiagnosticValue
                label="Causa"
                value={circuitBreaker.data.cause ?? "—"}
              />
              <DiagnosticValue
                label="Última transición"
                value={formatDateTime(circuitBreaker.data.lastTransitionAt)}
              />
            </dl>
            <p className="text-sm text-slate-300">
              {circuitBreaker.data.reason} · Siguiente acción:{" "}
              {circuitBreaker.data.nextAction}
            </p>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <MetricValue
                label="Crédito Kapso"
                value={
                  readiness.data === undefined
                    ? "—"
                    : `${formatCents(readiness.data.billing.creditCents)} · reserva ${formatCents(readiness.data.billing.creditReserveCents ?? 0)} · en vuelo ${formatCents(readiness.data.billing.creditInFlightCents ?? 0)}`
                }
              />
              <MetricValue
                label="Salud de crédito"
                value={
                  readiness.data === undefined
                    ? "—"
                    : `${billingHealthLabel(readiness.data.billingHealth.level)} · ${readiness.data.billingHealth.balancePercent === null ? "saldo sin límite" : `${readiness.data.billingHealth.balancePercent}%`} · ${readiness.data.billingHealth.autonomyDays === null ? "autonomía no estimada" : `${readiness.data.billingHealth.autonomyDays} días`}`
                }
              />
              <MetricValue
                label="Consumo cuota"
                value={
                  readiness.data === undefined
                    ? `${operationalMetrics.data?.quotaMessages ?? 0} mensajes`
                    : `${readiness.data.billing.kapsoQuotaConsumed ?? operationalMetrics.data?.quotaMessages ?? 0} + ${readiness.data.billing.kapsoQuotaInFlight ?? 0} en vuelo / ${readiness.data.billing.kapsoMonthlyQuota ?? "∞"} mensajes`
                }
              />
              <MetricValue
                label="Latencia media"
                value={
                  operationalMetrics.data?.averageLatencyMs === null ||
                  operationalMetrics.data?.averageLatencyMs === undefined
                    ? "—"
                    : `${operationalMetrics.data.averageLatencyMs} ms`
                }
              />
              <MetricValue
                label="Errores"
                value={String(operationalMetrics.data?.errors ?? 0)}
              />
              <MetricValue
                label="Entregas intentadas"
                value={String(
                  operationalMetrics.data?.deliveries.attempted ?? 0,
                )}
              />
              <MetricValue
                label="Entregas aceptadas / entregadas"
                value={`${operationalMetrics.data?.deliveries.accepted ?? 0} / ${operationalMetrics.data?.deliveries.delivered ?? 0}`}
              />
              <MetricValue
                label="Entregas fallidas / desconocidas"
                value={`${operationalMetrics.data?.deliveries.failed ?? 0} / ${operationalMetrics.data?.deliveries.unknown ?? 0}`}
              />
              <MetricValue
                label="Meta / plataforma (billing)"
                value={`${readiness.data?.billing.metaChargesCents ?? operationalMetrics.data?.metaChargesCents ?? 0} / ${readiness.data?.billing.platformChargesCents ?? operationalMetrics.data?.platformChargesCents ?? 0} centavos`}
              />
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <MetricValue
                label="Inbound / outbound"
                value={`${operationalMetrics.data?.inboundMessages ?? 0} / ${operationalMetrics.data?.outboundMessages ?? 0}`}
              />
              <MetricValue
                label="Media / plantillas / interactivos / reacciones"
                value={`${operationalMetrics.data?.mediaMessages ?? 0} / ${operationalMetrics.data?.templateMessages ?? 0} / ${operationalMetrics.data?.interactiveMessages ?? 0} / ${operationalMetrics.data?.reactionMessages ?? 0}`}
              />
              <MetricValue
                label="Recibos de lectura"
                value={String(operationalMetrics.data?.readReceipts ?? 0)}
              />
            </div>
            {operationalMetrics.data?.templates.length ? (
              <div>
                <h3 className="font-medium">Plantillas</h3>
                <ul className="mt-2 space-y-1 text-sm text-slate-300">
                  {operationalMetrics.data.templates.map((template) => (
                    <li key={template.name}>
                      {template.name}: {template.attempted} intentos ·{" "}
                      {template.failed} fallos
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {circuitBreaker.data.status === "open" ? (
              <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-sm">
                <p>
                  La reactivación ejecutará una prueba sintética contra el
                  webhook y cerrará el circuito solo si la evidencia es válida.
                </p>
                <label className="flex items-center gap-2">
                  <input
                    checked={causeFixed}
                    onChange={(event) => setCauseFixed(event.target.checked)}
                    type="checkbox"
                  />
                  Confirmo que la causa del corte fue corregida.
                </label>
                <label className="flex items-center gap-2">
                  <input
                    checked={manualConfirmation}
                    onChange={(event) =>
                      setManualConfirmation(event.target.checked)
                    }
                    type="checkbox"
                  />
                  Confirmo manualmente la reactivación de esta Clínica.
                </label>
                <button
                  className="rounded bg-amber-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
                  disabled={
                    !causeFixed ||
                    !manualConfirmation ||
                    reactivateCircuitBreaker.isPending
                  }
                  onClick={() =>
                    reactivateCircuitBreaker.mutate({
                      causeFixed: true,
                      clinicId,
                      manualConfirmation: true,
                    })
                  }
                  type="button"
                >
                  Ejecutar prueba y reactivar
                </button>
              </div>
            ) : null}
            {reactivateCircuitBreaker.error ? (
              <p className="text-sm text-amber-200" role="alert">
                {reactivateCircuitBreaker.error.message}
              </p>
            ) : null}
            <div className="space-y-2 border-t border-slate-700 pt-3">
              <p className="text-sm font-medium">Abrir corte operativo</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <select
                  className="rounded border border-slate-700 bg-slate-900 p-2 text-sm"
                  onChange={(event) =>
                    setOpenCause(event.target.value as typeof openCause)
                  }
                  value={openCause}
                >
                  <option value="provider-error">Error persistente</option>
                  <option value="webhook-paused">Webhook pausado</option>
                  <option value="high-failure-rate">Tasa alta de fallos</option>
                  <option value="credit-exhausted">Crédito agotado</option>
                  <option value="quota-exhausted">Cuota agotada</option>
                  <option value="meta-error">Error de Meta</option>
                  <option value="legal-block">Bloqueo legal</option>
                </select>
                <input
                  className="rounded border border-slate-700 bg-slate-900 p-2 text-sm"
                  onChange={(event) => setOpenReason(event.target.value)}
                  placeholder="Motivo operativo"
                  value={openReason}
                />
              </div>
              <button
                className="rounded border border-amber-300 px-3 py-2 text-sm text-amber-200 disabled:opacity-50"
                disabled={
                  openReason.trim() === "" || openCircuitBreaker.isPending
                }
                onClick={() =>
                  openCircuitBreaker.mutate({
                    cause: openCause,
                    clinicId,
                    reason: openReason.trim(),
                  })
                }
                type="button"
              >
                Abrir circuito para esta Clínica
              </button>
              {openCircuitBreaker.error ? (
                <p className="text-sm text-amber-200" role="alert">
                  {openCircuitBreaker.error.message}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
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
        <label className="block text-sm">
          Modalidad de WhatsApp
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
            onChange={(event) =>
              setOnboardingMode(event.target.value as WhatsAppOnboardingMode)
            }
            value={onboardingMode}
          >
            <option value="coexistence">Coexistence (v1)</option>
            <option value="dedicated">Dedicated (requiere ampliación)</option>
            <option value="later">Activar más tarde</option>
            <option value="not-integrated">No integrar</option>
          </select>
        </label>
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
              onboardingMode,
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
                    <dt className="inline">Reserva de crédito: </dt>
                    <dd className="inline">
                      {formatCents(
                        readiness.data.billing.creditReserveCents ?? 0,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Crédito en vuelo: </dt>
                    <dd className="inline">
                      {formatCents(
                        readiness.data.billing.creditInFlightCents ?? 0,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Salud: </dt>
                    <dd className="inline">
                      {billingHealthLabel(readiness.data.billingHealth.level)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Autonomía estimada: </dt>
                    <dd className="inline">
                      {readiness.data.billingHealth.autonomyDays === null
                        ? "No estimada"
                        : `${readiness.data.billingHealth.autonomyDays} días`}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Cuota Kapso: </dt>
                    <dd className="inline">
                      {readiness.data.billing.kapsoQuotaConsumed} /{" "}
                      {readiness.data.billing.kapsoMonthlyQuota ?? "∞"} mensajes
                      {readiness.data.billing.kapsoQuotaInFlight === undefined
                        ? ""
                        : ` · ${readiness.data.billing.kapsoQuotaInFlight} en vuelo`}
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
            {readiness.data.alerts?.some((alert) => alert.status === "open") ? (
              <div
                className="rounded-lg border border-rose-500/70 bg-rose-950/30 p-4"
                data-whatsapp-connection-alerts="true"
                role="alert"
              >
                <p className="font-medium text-rose-100">
                  Alertas operativas de WhatsApp
                </p>
                <ul className="mt-2 space-y-2 text-sm text-rose-100/90">
                  {readiness.data.alerts
                    .filter((alert) => alert.status === "open")
                    .map((alert) => (
                      <li key={alert.id}>
                        <span className="font-medium">
                          {apoloReadinessGateLabel(alert.gateCode)}:
                        </span>{" "}
                        {alert.reason}{" "}
                        <span className="text-rose-100/70">
                          Siguiente acción: {alert.nextAction}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
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
                  {gate.code === "webhooks" ||
                  gate.code === "templates" ||
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
                            gate.code === "webhooks"
                              ? "webhooks"
                              : gate.code === "templates"
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
                        gate.code === "webhooks"
                          ? "webhooks"
                          : gate.code === "templates"
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
      <section
        aria-labelledby="whatsapp-final-operations-title"
        className="space-y-4 rounded-xl border border-rose-500/70 p-5"
        data-whatsapp-final-operations="true"
      >
        <div>
          <h2
            className="text-xl font-semibold"
            id="whatsapp-final-operations-title"
          >
            Piloto, tráfico real y retirada de WhatsApp
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            El smoke usa el contacto sintético de la Clínica seleccionada. No
            crea Pacientes ni habilita datos reales. El número, WABA y las
            plantillas Meta se conservan durante el offboarding.
          </p>
        </div>
        {!clinicId ? (
          <p className="text-sm text-slate-400">
            Seleccione una Clínica para operar el piloto.
          </p>
        ) : whatsappOperations.isLoading ? (
          <p className="text-sm text-slate-300" role="status">
            Consultando controles de tráfico…
          </p>
        ) : whatsappOperations.error ? (
          <p className="text-sm text-amber-200" role="alert">
            {whatsappOperations.error.message}
          </p>
        ) : whatsappOperations.data ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <DiagnosticValue
                label="Tráfico real"
                value={whatsappTrafficStatusLabel(
                  whatsappOperations.data.trafficStatus,
                )}
              />
              <DiagnosticValue
                label="Smoke sintético"
                value={
                  whatsappOperations.data.latestSmoke?.status === "passed"
                    ? "Aprobado"
                    : "Pendiente o fallido"
                }
              />
              <DiagnosticValue
                label="Readiness técnico"
                value={
                  whatsappOperations.data.technicalReadiness.status === "ready"
                    ? "Listo"
                    : "Bloqueado"
                }
              />
              <DiagnosticValue
                label="Circuit breaker"
                value={
                  whatsappOperations.data.circuitStatus === "closed"
                    ? "Cerrado"
                    : "Abierto"
                }
              />
            </dl>
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Smoke E2E sintético</h3>
                  <p className="mt-1 text-sm text-slate-300">
                    Cubre conexión, recepción, respuesta, takeover, history
                    sync, templates, delivery, duplicados, 429/timeout y los
                    controles Kapso/Consentimiento.
                  </p>
                </div>
                <button
                  className="rounded bg-sky-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
                  disabled={runSyntheticSmoke.isPending}
                  onClick={() => runSyntheticSmoke.mutate({ clinicId })}
                  type="button"
                >
                  {runSyntheticSmoke.isPending
                    ? "Ejecutando…"
                    : "Ejecutar smoke sintético"}
                </button>
              </div>
              {whatsappOperations.data.latestSmoke ? (
                <>
                  <p className="mt-3 text-sm">
                    Resultado:{" "}
                    <strong>
                      {whatsappOperations.data.latestSmoke.status === "passed"
                        ? "aprobado"
                        : "fallido"}
                    </strong>{" "}
                    · contacto sintético:{" "}
                    {whatsappOperations.data.latestSmoke.syntheticContact
                      ? "sí"
                      : "no"}{" "}
                    · Pacientes reales habilitados:{" "}
                    {whatsappOperations.data.latestSmoke.realPatientsEnabled
                      ? "sí"
                      : "no"}
                  </p>
                  <ul className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                    {whatsappOperations.data.latestSmoke.steps.map((step) => (
                      <li key={step.code}>
                        <span
                          className={
                            step.passed ? "text-teal-200" : "text-rose-200"
                          }
                        >
                          {step.passed ? "✓" : "✕"}{" "}
                          {whatsappSyntheticSmokeStepLabels[step.code]}
                        </span>
                        {step.message ? " · " + step.message : ""}
                      </li>
                    ))}
                  </ul>
                  {whatsappOperations.data.latestSmoke.blockers.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-200">
                      {whatsappOperations.data.latestSmoke.blockers.map(
                        (blocker) => (
                          <li key={blocker.code + "-" + blocker.message}>
                            {blocker.message}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-amber-200">
                  Todavía no existe evidencia de smoke sintético.
                </p>
              )}
              {runSyntheticSmoke.error ? (
                <p className="mt-2 text-sm text-amber-200" role="alert">
                  {runSyntheticSmoke.error.message}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <h3 className="font-semibold">Gates para tráfico real</h3>
              <p className="mt-1 text-sm text-slate-300">
                Registre una referencia operativa breve por gate. No introduzca
                PII, tokens, QR ni credenciales.
              </p>
              <ul className="mt-3 space-y-3">
                {whatsappRealTrafficGateCodes.map((code) => {
                  const gate = whatsappOperations.data.gates[code];
                  const evidence =
                    gateEvidence[code] ?? gate?.evidenceReference ?? "";
                  return (
                    <li
                      className="flex flex-col gap-2 sm:flex-row sm:items-center"
                      key={code}
                    >
                      <label className="flex-1 text-sm">
                        <span className="block text-slate-200">
                          {whatsappRealTrafficGateLabel(code)}
                        </span>
                        <input
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                          onChange={(event) =>
                            setGateEvidence((current) => ({
                              ...current,
                              [code]: event.target.value,
                            }))
                          }
                          placeholder="Referencia de evidencia"
                          value={evidence}
                        />
                      </label>
                      <button
                        className="rounded border border-teal-300 px-3 py-2 text-sm text-teal-100 disabled:opacity-50"
                        disabled={recordTrafficGate.isPending}
                        onClick={() =>
                          recordTrafficGate.mutate({
                            clinicId,
                            code,
                            evidenceReference: evidence.trim() || null,
                            ready: evidence.trim() !== "",
                          })
                        }
                        type="button"
                      >
                        {gate?.ready ? "Actualizar" : "Registrar"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {recordTrafficGate.error ? (
                <p className="mt-2 text-sm text-amber-200" role="alert">
                  {recordTrafficGate.error.message}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-amber-500/70 bg-amber-950/20 p-4">
              <h3 className="font-semibold">Habilitación explícita</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                {whatsappOperations.data.trafficEvaluation.blockers.length ===
                0 ? (
                  <li>Todos los gates necesarios están presentes.</li>
                ) : (
                  whatsappOperations.data.trafficEvaluation.blockers.map(
                    (blocker: WhatsAppRealTrafficBlocker) => (
                      <li key={blocker.code + "-" + blocker.message}>
                        {blocker.message}
                      </li>
                    ),
                  )
                )}
              </ul>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  checked={realTrafficConfirmation}
                  onChange={(event) =>
                    setRealTrafficConfirmation(event.target.checked)
                  }
                  type="checkbox"
                />
                Confirmo que la Clínica está autorizada para tráfico real.
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded bg-amber-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
                  disabled={
                    !whatsappOperations.data.trafficEvaluation.allowed ||
                    !realTrafficConfirmation ||
                    enableRealTraffic.isPending
                  }
                  onClick={() =>
                    enableRealTraffic.mutate({
                      clinicId,
                      manualConfirmation: true,
                    })
                  }
                  type="button"
                >
                  Habilitar tráfico real
                </button>
                <button
                  className="rounded border border-rose-300 px-3 py-2 text-rose-100 disabled:opacity-50"
                  disabled={
                    whatsappOperations.data.trafficStatus !== "enabled" ||
                    !realTrafficConfirmation ||
                    revertRealTraffic.isPending
                  }
                  onClick={() =>
                    revertRealTraffic.mutate({
                      clinicId,
                      manualConfirmation: true,
                      reason: "Reversión manual desde Operación comercial",
                    })
                  }
                  type="button"
                >
                  Revertir y abrir circuit breaker
                </button>
              </div>
              {enableRealTraffic.error || revertRealTraffic.error ? (
                <p className="mt-2 text-sm text-amber-200" role="alert">
                  {
                    (enableRealTraffic.error ?? revertRealTraffic.error)
                      ?.message
                  }
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-rose-500/70 bg-rose-950/20 p-4">
              <h3 className="font-semibold">Offboarding de la Conexión</h3>
              <p className="mt-1 text-sm text-slate-300">
                Detiene envíos, desconecta y desactiva webhooks/setup links de
                Praxia. No elimina el número, WABA ni plantillas de la Clínica.
                Cada paso queda auditado y los fallos pueden reintentarse.
              </p>
              <p className="mt-2 text-sm text-slate-300">
                Autorización de la Clínica:{" "}
                {whatsappOperations.data.offboardingAuthorization === null
                  ? "pendiente del Médico propietario"
                  : `registrada por ${whatsappOperations.data.offboardingAuthorization.authorizedByIdentityId}`}
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  checked={offboardingConfirmation}
                  onChange={(event) =>
                    setOffboardingConfirmation(event.target.checked)
                  }
                  type="checkbox"
                />
                Confirmo retirar la Conexión de Praxia.
              </label>
              <button
                className="mt-3 rounded bg-rose-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
                disabled={
                  !offboardingConfirmation ||
                  whatsappOperations.data.offboardingAuthorization === null ||
                  offboardConnection.isPending
                }
                onClick={() => offboardConnection.mutate({ clinicId })}
                type="button"
              >
                {offboardConnection.isPending
                  ? "Retirando…"
                  : "Retirar Conexión"}
              </button>
              {whatsappOperations.data.offboarding ? (
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    Última retirada:{" "}
                    {whatsappOperations.data.offboarding.status}
                  </p>
                  <ul className="space-y-1 text-slate-300">
                    {whatsappOperations.data.offboarding.steps.map(
                      (step, index) => (
                        <li key={step.code + "-" + index}>
                          {step.status === "succeeded" ? "✓" : "✕"}{" "}
                          {step.message}
                          {step.effect === "already-complete"
                            ? " (idempotente)"
                            : ""}
                        </li>
                      ),
                    )}
                  </ul>
                  <details>
                    <summary className="cursor-pointer text-teal-200">
                      Ver exportación de configuración permitida
                    </summary>
                    <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
                      {JSON.stringify(
                        whatsappOperations.data.offboarding.configurationExport,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ) : null}
              {offboardConnection.error ? (
                <p className="mt-2 text-sm text-amber-200" role="alert">
                  {offboardConnection.error.message}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
      <WhatsAppActivationClosureSection
        clinicId={clinicId}
        refreshToken={activationRefreshToken}
      />
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
  action: "templates" | "billing" | "e2e" | "webhooks" | "reactivate",
) {
  return {
    billing: "Reintentar billing",
    e2e: "Ejecutar prueba E2E",
    reactivate: "Reactivar conexión",
    templates: "Sincronizar plantillas",
    webhooks: "Reintentar webhooks",
  }[action];
}

function whatsappTrafficStatusLabel(
  status: "blocked" | "enabled" | "offboarded",
) {
  return {
    blocked: "Bloqueado",
    enabled: "Habilitado",
    offboarded: "Retirado",
  }[status];
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function billingHealthLabel(level: "normal" | "warning" | "critical") {
  return {
    critical: "Crítica",
    normal: "Normal",
    warning: "Advertencia",
  }[level];
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

function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="text-xs tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-1 font-medium text-slate-100">{value}</p>
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
