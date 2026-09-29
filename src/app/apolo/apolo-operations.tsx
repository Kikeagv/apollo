"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createAdministrativeOperationKey,
  getAdministrativeOperationFeedback,
  type AdministrativeOperationFeedback as AdministrativeOperationFeedbackState,
} from "~/domain/administrative-operation";
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
import {
  isValidE164PhoneNumber,
  type WhatsAppOnboardingMode,
} from "~/domain/whatsapp-preflight";
import {
  supervisionTabs,
  type SupervisionTabId,
} from "~/domain/supervision-navigation";
import {
  evaluateWhatsAppCircuitReactivationEvidence,
  whatsappCircuitReactivationEvidenceMaxAgeMs,
} from "~/domain/whatsapp-circuit-breaker";
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
import { ClinicSupervisionSummary } from "./clinic-supervision-summary";
import { SupervisionSystem } from "./supervision-system";
import { SupervisionTabs } from "./supervision-tabs";
import { SupervisionTemplates } from "./supervision-templates";
import {
  getSupervisionOperationStatusLabel,
  SupervisionTechnicalDetails,
} from "./supervision-diagnostics";

const operationStatusLabels = {
  idle: "Sin operación",
  pending: "En proceso",
  success: "Completado",
};
const supportQueryStatusLabels = {
  idle: "Sin consulta",
  pending: "En proceso",
  success: "Completada",
};

/** Consola interna de supervisión y operación comercial de Apolo. */
export function ApoloOperations() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const clinicId = searchParams.get("clinicId") ?? "";
  const activeTab = getSupervisionTab(searchParams.get("tab"));
  const previousClinicId = useRef(clinicId);
  const updateSupervisionContext = (changes: {
    clinicId?: string;
    tab?: SupervisionTabId;
  }) => {
    const params = new URLSearchParams(search);
    if (changes.clinicId !== undefined) {
      if (changes.clinicId) params.set("clinicId", changes.clinicId);
      else params.delete("clinicId");
    }
    if (changes.tab !== undefined) {
      if (changes.tab === "overview") params.delete("tab");
      else params.set("tab", changes.tab);
    }
    const nextSearch = params.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
      scroll: false,
    });
  };
  const [smokeTestPhone, setSmokeTestPhone] = useState("");
  const [activationRefreshToken, setActivationRefreshToken] = useState(0);
  const [reactivationEvidenceNow, setReactivationEvidenceNow] = useState(
    () => new Date(),
  );
  const refreshActivationContract = () =>
    setActivationRefreshToken((value) => value + 1);
  const utils = api.useUtils();
  const refreshSupervisionSummary = () => {
    if (clinicId) {
      void utils.apolo.getClinicSupervisionSummary.invalidate({ clinicId });
    }
  };
  const clinics = api.apolo.listCommercialClinics.useQuery();
  const selectedClinic = clinics.data?.find((clinic) => clinic.id === clinicId);
  const onboarding = api.apolo.getKapsoOnboarding.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) && activeTab === "whatsapp" },
  );
  const readiness = api.apolo.getWhatsAppReadiness.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) && activeTab === "whatsapp" },
  );
  const circuitBreaker = api.apolo.getWhatsAppCircuitBreaker.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) && activeTab === "whatsapp" },
  );
  const operationalMetrics = api.apolo.getWhatsAppOperationalMetrics.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) && activeTab === "whatsapp" },
  );
  const whatsappOperations = api.apolo.getWhatsAppOperations.useQuery(
    { clinicId },
    {
      enabled: Boolean(clinicId) && activeTab === "whatsapp",
      refetchInterval: (query) =>
        query.state.data?.latestSmoke?.status === "pending" ? 2_000 : false,
    },
  );
  const latestSmoke = whatsappOperations.data?.latestSmoke ?? null;
  const operationConnection = whatsappOperations.data?.connection ?? null;
  const connectionReady = onboarding.data?.connection?.status === "ready";
  const readinessReady = readiness.data?.readiness.status === "ready";
  const smokePassed = latestSmoke?.status === "passed";
  const trafficAllowed =
    whatsappOperations.data?.trafficEvaluation.allowed === true;
  const trafficEnabled = whatsappOperations.data?.trafficStatus === "enabled";
  const connectionStageDetail =
    onboarding.data?.preflight?.blockers[0]?.message ??
    onboarding.data?.preflight?.reason ??
    onboarding.data?.preflight?.nextAction ??
    "Confirme los datos del Médico propietario y del número.";
  const readinessStageDetail =
    readiness.data?.readiness.gates.find((gate) => gate.status !== "ready")
      ?.message ??
    readiness.data?.readiness.legalAuthorization.message ??
    "La preparación técnica todavía no está confirmada.";
  const smokeStageDetail =
    latestSmoke?.blockers[0]?.message ??
    (latestSmoke?.status === "pending"
      ? "El roundtrip controlado sigue en espera."
      : "No hay una prueba controlada aprobada para esta Conexión.");
  const authorizationStageDetail =
    whatsappOperations.data?.trafficEvaluation.blockers[0]?.message ??
    (trafficAllowed
      ? "Los gates están presentes; falta confirmar y habilitar el tráfico."
      : "Registre la evidencia requerida por cada gate.");
  useEffect(() => {
    if (latestSmoke?.finishedAt === null || latestSmoke === null) return;
    const remainingMs =
      latestSmoke.finishedAt.valueOf() +
      whatsappCircuitReactivationEvidenceMaxAgeMs -
      Date.now() +
      1;
    if (remainingMs <= 0) {
      setReactivationEvidenceNow(new Date());
      return;
    }
    const timeout = setTimeout(
      () => setReactivationEvidenceNow(new Date()),
      remainingMs,
    );
    return () => clearTimeout(timeout);
  }, [latestSmoke]);
  const reactivationEvidence = evaluateWhatsAppCircuitReactivationEvidence({
    connectionGenerationId: operationConnection?.provisioningEventId ?? null,
    connectionProvider: operationConnection?.provider ?? "kapso",
    now: reactivationEvidenceNow,
    smoke: latestSmoke,
  });
  const [amountUsd, setAmountUsd] = useState("");
  const [reference, setReference] = useState("");
  const [paymentReview, setPaymentReview] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [supportDurationMinutes, setSupportDurationMinutes] = useState("60");
  const [expiresAt, setExpiresAt] = useState(() =>
    toDateTimeLocalValue(new Date(Date.now() + 60 * 60_000)),
  );
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
  const [paymentAttempt, setPaymentAttempt] =
    useState<AdministrativeOperationAttempt | null>(null);
  const [subscriptionAttempt, setSubscriptionAttempt] =
    useState<AdministrativeOperationAttempt | null>(null);
  const [supportAttempt, setSupportAttempt] =
    useState<AdministrativeOperationAttempt | null>(null);
  const prepareOnboarding =
    api.apolo.prepareKapsoWhatsAppOnboarding.useMutation({
      onSuccess: () => {
        void onboarding.refetch();
        refreshActivationContract();
        refreshSupervisionSummary();
      },
    });
  const manageSetupLink = api.apolo.manageKapsoWhatsAppSetupLink.useMutation({
    onSuccess: () => {
      void onboarding.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
    },
  });
  const retryReadiness = api.apolo.retryWhatsAppReadiness.useMutation({
    onSuccess: () => {
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
    },
    onError: () => {
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
    },
  });
  const openCircuitBreaker = api.apolo.openWhatsAppCircuitBreaker.useMutation({
    onSuccess: () => {
      setOpenReason("");
      void circuitBreaker.refetch();
      void readiness.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
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
        refreshSupervisionSummary();
      },
      onError: () => {
        void circuitBreaker.refetch();
        refreshActivationContract();
        refreshSupervisionSummary();
      },
    });
  const recordPayment = api.apolo.recordTransferPayment.useMutation({
    onSuccess: () => {
      refreshSupervisionSummary();
      void recentPayments.refetch();
    },
  });
  const setSubscription = api.apolo.changeSubscriptionStatus.useMutation({
    onSuccess: () => {
      void clinics.refetch();
      refreshSupervisionSummary();
    },
  });
  const openSupport = api.apolo.openSupportSession.useMutation({
    onSuccess: (session) => {
      setSupportSessionId(session.id);
      void supportSessions.refetch();
    },
  });
  const readSupport = api.apolo.readSupportClinicSummary.useMutation();
  const recentPayments = api.apolo.listRecentTransferPayments.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) && activeTab === "payments" },
  );
  const supportSessions = api.apolo.listSuperadminSupportSessions.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) && activeTab === "support" },
  );
  const recordTrafficGate = api.apolo.recordWhatsAppTrafficGate.useMutation({
    onSuccess: () => {
      void whatsappOperations.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
    },
  });
  const runSyntheticSmoke = api.apolo.runWhatsAppSyntheticSmoke.useMutation({
    onSuccess: () => {
      void whatsappOperations.refetch();
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
    },
  });
  const enableRealTraffic = api.apolo.enableWhatsAppRealTraffic.useMutation({
    onSuccess: () => {
      setRealTrafficConfirmation(false);
      void whatsappOperations.refetch();
      void readiness.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
    },
  });
  const revertRealTraffic = api.apolo.revertWhatsAppRealTraffic.useMutation({
    onSuccess: () => {
      setRealTrafficConfirmation(false);
      void whatsappOperations.refetch();
      void readiness.refetch();
      void circuitBreaker.refetch();
      refreshActivationContract();
      refreshSupervisionSummary();
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
      refreshSupervisionSummary();
    },
  });

  const resetClinicOperationState = useCallback(() => {
    setSmokeTestPhone("");
    setReactivationEvidenceNow(new Date());
    setAmountUsd("");
    setReference("");
    setPaymentReview(null);
    setReason("");
    setSupportDurationMinutes("60");
    setExpiresAt(toDateTimeLocalValue(new Date(Date.now() + 60 * 60_000)));
    setSupportSessionId("");
    setOnboardingOwnerName("");
    setPhoneNumberE164("");
    setNumberOwnedByClinic(false);
    setOnboardingMode("coexistence");
    setOwnerConfirmed(false);
    setWhatsappBusinessApp("active");
    setMetaAuthority("not-confirmed");
    setQrDeviceAvailable(false);
    setCauseFixed(false);
    setManualConfirmation(false);
    setRealTrafficConfirmation(false);
    setOffboardingConfirmation(false);
    setGateEvidence({});
    setOpenCause("provider-error");
    setOpenReason("");
    setPaymentAttempt(null);
    setSubscriptionAttempt(null);
    setSupportAttempt(null);
    prepareOnboarding.reset();
    manageSetupLink.reset();
    retryReadiness.reset();
    openCircuitBreaker.reset();
    reactivateCircuitBreaker.reset();
    recordPayment.reset();
    setSubscription.reset();
    openSupport.reset();
    readSupport.reset();
    recordTrafficGate.reset();
    runSyntheticSmoke.reset();
    enableRealTraffic.reset();
    revertRealTraffic.reset();
    offboardConnection.reset();
  }, [
    enableRealTraffic,
    manageSetupLink,
    offboardConnection,
    openCircuitBreaker,
    openSupport,
    prepareOnboarding,
    readSupport,
    recordPayment,
    recordTrafficGate,
    reactivateCircuitBreaker,
    retryReadiness,
    revertRealTraffic,
    runSyntheticSmoke,
    setSubscription,
  ]);
  useEffect(() => {
    if (previousClinicId.current === clinicId) return;
    previousClinicId.current = clinicId;
    resetClinicOperationState();
  }, [clinicId, resetClinicOperationState]);

  const submitPayment = () => {
    const fingerprint = `${clinicId}|${amountUsd}|${reference.trim()}`;
    const isValid =
      Boolean(clinicId) &&
      /^\d+(\.\d{2})$/.test(amountUsd) &&
      Number(amountUsd) > 0 &&
      reference.trim().length > 0 &&
      paymentReview === fingerprint;
    const currentAttempt =
      paymentAttempt?.fingerprint === fingerprint ? paymentAttempt : null;
    if (!isValid) {
      setPaymentAttempt({ fingerprint, key: null });
      return;
    }
    const operationKey =
      currentAttempt?.key ??
      createAdministrativeOperationKey("transfer-payment", crypto.randomUUID());
    setPaymentAttempt({ fingerprint, key: operationKey });
    recordPayment.mutate({
      amountUsd,
      clinicId,
      operationKey,
      reference: reference.trim(),
    });
  };

  const submitSubscription = (status: "active" | "suspended") => {
    const fingerprint = `${clinicId}|${status}`;
    const currentAttempt =
      subscriptionAttempt?.fingerprint === fingerprint
        ? subscriptionAttempt
        : null;
    if (!clinicId) {
      setSubscriptionAttempt({ fingerprint, key: null });
      return;
    }
    const operationKey =
      currentAttempt?.key ??
      createAdministrativeOperationKey(
        "subscription-status",
        crypto.randomUUID(),
      );
    setSubscriptionAttempt({ fingerprint, key: operationKey });
    setSubscription.mutate({ clinicId, operationKey, status });
  };

  const submitSupport = () => {
    const fingerprint = `${clinicId}|${reason.trim()}|${expiresAt}`;
    const parsedExpiresAt = new Date(expiresAt);
    const isValid =
      Boolean(clinicId) &&
      reason.trim().length > 0 &&
      Number.isFinite(parsedExpiresAt.getTime()) &&
      parsedExpiresAt.getTime() > Date.now();
    const currentAttempt =
      supportAttempt?.fingerprint === fingerprint ? supportAttempt : null;
    const canRecover =
      currentAttempt?.key !== null && currentAttempt?.key !== undefined;
    if (!isValid && !canRecover) {
      setSupportAttempt({ fingerprint, key: null });
      return;
    }
    const operationKey =
      currentAttempt?.key ??
      createAdministrativeOperationKey("support-session", crypto.randomUUID());
    setSupportAttempt({ fingerprint, key: operationKey });
    openSupport.mutate({
      clinicId,
      expiresAt: parsedExpiresAt,
      operationKey,
      reason: reason.trim(),
    });
  };

  const paymentFingerprint = `${clinicId}|${amountUsd}|${reference.trim()}`;
  const paymentInputValid =
    Boolean(clinicId) &&
    /^\d+(\.\d{2})$/.test(amountUsd) &&
    Number(amountUsd) > 0 &&
    reference.trim().length > 0;
  const paymentAttemptIsCurrent =
    paymentAttempt?.fingerprint === paymentFingerprint;
  const paymentFeedback = getAdministrativeOperationFeedback({
    attempted: paymentAttemptIsCurrent,
    errorMessage: recordPayment.error?.message,
    isError: paymentAttemptIsCurrent && recordPayment.isError,
    isPending: paymentAttemptIsCurrent && recordPayment.isPending,
    isSuccess: paymentAttemptIsCurrent && recordPayment.isSuccess,
    isValid: paymentInputValid,
    operationKey: paymentAttempt?.key ?? undefined,
  });
  const subscriptionAttemptIsCurrent =
    Boolean(clinicId) && subscriptionAttempt !== null;
  const subscriptionFeedback = getAdministrativeOperationFeedback({
    attempted: subscriptionAttemptIsCurrent,
    errorMessage: setSubscription.error?.message,
    isError: subscriptionAttemptIsCurrent && setSubscription.isError,
    isPending: subscriptionAttemptIsCurrent && setSubscription.isPending,
    isSuccess: subscriptionAttemptIsCurrent && setSubscription.isSuccess,
    isValid: Boolean(clinicId),
    operationKey: subscriptionAttempt?.key ?? undefined,
  });
  const supportFingerprint = `${clinicId}|${reason.trim()}|${expiresAt}`;
  const supportExpiresAt = new Date(expiresAt);
  const supportAttemptIsCurrent =
    supportAttempt?.fingerprint === supportFingerprint;
  const supportInputValid =
    (Boolean(clinicId) &&
      reason.trim().length > 0 &&
      Number.isFinite(supportExpiresAt.getTime()) &&
      supportExpiresAt.getTime() > Date.now()) ||
    (supportAttemptIsCurrent &&
      supportAttempt?.key !== null &&
      supportAttempt?.key !== undefined);
  const supportFeedback = getAdministrativeOperationFeedback({
    attempted: supportAttemptIsCurrent,
    errorMessage: openSupport.error?.message,
    isError: supportAttemptIsCurrent && openSupport.isError,
    isPending: supportAttemptIsCurrent && openSupport.isPending,
    isSuccess: supportAttemptIsCurrent && openSupport.isSuccess,
    isValid: supportInputValid,
    operationKey: supportAttempt?.key ?? undefined,
  });
  const registrationParams = new URLSearchParams({ tab: activeTab });
  if (clinicId) registrationParams.set("clinicId", clinicId);
  const registrationHref = `/apolo/alta?${registrationParams.toString()}`;

  return (
    <main className="supervision-console bg-background text-foreground [&_*:focus-visible]:outline-ring mx-auto min-h-screen max-w-7xl space-y-6 p-4 sm:p-8 [&_*:focus-visible]:outline [&_*:focus-visible]:outline-2 [&_*:focus-visible]:outline-offset-2">
      <header className="space-y-2">
        <p className="text-primary text-sm font-medium tracking-[0.2em]">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold">Supervisión</h1>
        <p className="text-foreground max-w-3xl">
          Acceso, suscripción, conexión y capacidad de mensajería por Clínica,
          con operación comercial y diagnósticos del sistema.
        </p>
      </header>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="block min-w-64 flex-1 text-sm">
          Clínica
          <select
            className="border-border bg-muted focus-visible:outline-ring mt-1 w-full rounded border p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onChange={(event) =>
              updateSupervisionContext({ clinicId: event.target.value })
            }
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
        <a
          className="border-primary/30 text-primary focus-visible:outline-ring inline-flex rounded border px-3 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          href={registrationHref}
        >
          Alta comercial o sintética
        </a>
      </div>
      <SupervisionTabs
        value={activeTab}
        onChange={(tab) => updateSupervisionContext({ tab })}
      />
      <section
        aria-labelledby="supervision-tab-overview"
        className="space-y-5"
        hidden={activeTab !== "overview"}
        id="supervision-panel-overview"
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "overview" ? (
          <ClinicSupervisionSummary
            clinicId={clinicId}
            onNavigate={(tab) => updateSupervisionContext({ tab })}
          />
        ) : null}
      </section>
      <section
        aria-labelledby="supervision-tab-templates"
        className="space-y-5"
        hidden={activeTab !== "templates"}
        id="supervision-panel-templates"
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "templates" ? (
          <SupervisionTemplates
            clinicId={clinicId}
            clinicName={selectedClinic?.name}
          />
        ) : null}
      </section>
      <section
        aria-labelledby="supervision-tab-system"
        className="space-y-5"
        hidden={activeTab !== "system"}
        id="supervision-panel-system"
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "system" ? <SupervisionSystem /> : null}
      </section>
      <section
        aria-labelledby="supervision-tab-whatsapp"
        className="space-y-5"
        hidden={activeTab !== "whatsapp"}
        id="supervision-panel-whatsapp"
        role="tabpanel"
        tabIndex={0}
      >
        <section
          aria-labelledby="whatsapp-activation-stages-title"
          className="border-border bg-card space-y-4 rounded-xl border p-5"
        >
          <div>
            <p className="text-primary text-xs font-semibold tracking-wide uppercase">
              Operación por etapas
            </p>
            <h2
              className="mt-1 text-xl font-semibold"
              id="whatsapp-activation-stages-title"
            >
              Activación de WhatsApp
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Revisa el paso pendiente y su bloqueo antes de abrir diagnósticos
              y evidencia técnica.
            </p>
          </div>
          {!clinicId ? (
            <p className="text-muted-foreground text-sm">
              Selecciona una Clínica para ver su etapa de activación.
            </p>
          ) : (
            <WhatsAppActivationStages
              authorizationDetail={authorizationStageDetail}
              connectionDetail={connectionStageDetail}
              connectionReady={connectionReady}
              readinessDetail={readinessStageDetail}
              readinessReady={readinessReady}
              smokeDetail={smokeStageDetail}
              smokePassed={smokePassed}
              trafficAllowed={trafficAllowed}
              trafficEnabled={trafficEnabled}
            />
          )}
        </section>
        {circuitBreaker.data?.status === "open" ? (
          <section
            aria-labelledby="whatsapp-circuit-breaker-attention-title"
            className="border-warning-border bg-warning-muted rounded-xl border p-4"
            role="status"
          >
            <h3
              className="text-warning-foreground font-semibold"
              id="whatsapp-circuit-breaker-attention-title"
            >
              WhatsApp está pausado por el circuit breaker
            </h3>
            <p className="text-warning-foreground mt-1 text-sm">
              {circuitBreaker.data.reason}
            </p>
            <p className="text-warning-foreground mt-1 text-sm">
              Siguiente acción: {circuitBreaker.data.nextAction}
            </p>
            <a
              className="text-primary mt-3 inline-flex font-medium underline underline-offset-4"
              href="#whatsapp-circuit-breaker"
            >
              Abrir controles de reactivación
            </a>
          </section>
        ) : null}
        <SupervisionTechnicalDetails
          id="whatsapp-circuit-breaker"
          open={circuitBreaker.data?.status === "open"}
          summary="Diagnóstico técnico de capacidad, circuit breaker y métricas"
        >
          <section
            aria-labelledby="whatsapp-circuit-breaker-title"
            className="border-warning-border space-y-4 rounded-xl border p-5"
            data-whatsapp-circuit-breaker="true"
          >
            <div>
              <h2
                className="text-xl font-semibold"
                id="whatsapp-circuit-breaker-title"
              >
                Circuit breaker, crédito y métricas
              </h2>
              <p className="text-foreground mt-1 text-sm">
                El corte es por Clínica. Pausa el agente y la outbox de
                WhatsApp, conserva los eventos pendientes y deja disponible la
                WhatsApp Business App para continuidad manual.
              </p>
            </div>
            {!clinicId ? (
              <p className="text-muted-foreground text-sm">
                Selecciona una Clínica para consultar su operación.
              </p>
            ) : circuitBreaker.isLoading ? (
              <p className="text-foreground text-sm" role="status">
                Consultando el circuito…
              </p>
            ) : circuitBreaker.error ? (
              <p className="text-warning-foreground text-sm" role="alert">
                {circuitBreaker.error.message}
              </p>
            ) : circuitBreaker.data ? (
              <>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <DiagnosticValue
                    label="Estado"
                    value={
                      circuitBreaker.data.status === "open"
                        ? "Abierto"
                        : "Cerrado"
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
                <p className="text-foreground text-sm">
                  Motivo del corte: {circuitBreaker.data.reason}
                </p>
                <dl className="border-border grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-3">
                  <DiagnosticValue
                    label="Responsable del corte"
                    value={
                      circuitBreaker.data.openedBy === null
                        ? "Sin actor registrado"
                        : circuitBreaker.data.openedBy.actorKind ===
                            "superadmin"
                          ? (circuitBreaker.data.openedBy.displayName ??
                            circuitBreaker.data.openedBy.actorIdentityId ??
                            "Superadmin")
                          : circuitBreaker.data.openedBy.actorKind === "system"
                            ? "Sistema automático"
                            : "Worker de WhatsApp"
                    }
                  />
                  <DiagnosticValue
                    label="Evidencia E2E más reciente"
                    value={
                      latestSmoke === null
                        ? (circuitBreaker.data.lastSyntheticEvidence ??
                          "Todavía no hay evidencia E2E")
                        : `${latestSmoke.status === "passed" ? "Aprobada" : latestSmoke.status === "pending" ? "Pendiente" : "Fallida"} · ${formatDateTime(latestSmoke.finishedAt)} · ${latestSmoke.evidence ?? (latestSmoke.blockers.map(({ message }) => message).join("; ") || "sin resumen")}`
                    }
                  />
                  <DiagnosticValue
                    label="Siguiente acción"
                    value={circuitBreaker.data.nextAction}
                  />
                </dl>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <MetricValue
                    label="Crédito Kapso"
                    value={
                      readiness.data === undefined
                        ? "—"
                        : readiness.data.billing.creditBalanceKnown === true
                          ? `${formatCents(readiness.data.billing.creditCents)} · reserva ${formatCents(readiness.data.billing.creditReserveCents ?? 0)} · en vuelo ${formatCents(readiness.data.billing.creditInFlightCents ?? 0)}`
                          : `${kapsoFundingStatusLabel(readiness.data.billing.kapsoFundingStatus)} · saldo no expuesto por API`
                    }
                  />
                  <MetricValue
                    label="Salud de crédito"
                    value={
                      readiness.data === undefined
                        ? "—"
                        : readiness.data.billing.creditBalanceKnown !== true
                          ? "Saldo no consultable por API"
                          : `${billingHealthLabel(readiness.data.billingHealth.level)} · ${readiness.data.billingHealth.balancePercent === null ? "saldo sin límite" : `${readiness.data.billingHealth.balancePercent}%`} · ${readiness.data.billingHealth.autonomyDays === null ? "autonomía no estimada" : `${readiness.data.billingHealth.autonomyDays} días`}`
                    }
                  />
                  <MetricValue
                    label="Consumo cuota"
                    value={
                      readiness.data === undefined
                        ? `${operationalMetrics.data?.quotaMessages ?? 0} mensajes`
                        : readiness.data.billing.kapsoMonthlyQuota == null
                          ? "Cuota no consultable por API"
                          : `${readiness.data.billing.kapsoQuotaConsumed ?? operationalMetrics.data?.quotaMessages ?? 0} + ${readiness.data.billing.kapsoQuotaInFlight ?? 0} en vuelo / ${readiness.data.billing.kapsoMonthlyQuota} mensajes`
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
                    <ul className="text-foreground mt-2 space-y-1 text-sm">
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
                  <div className="border-warning-border bg-warning-muted space-y-2 rounded-lg border p-3 text-sm">
                    <p>
                      Ejecute y complete el smoke E2E en el panel de Operación
                      de WhatsApp. La reactivación usará el último roundtrip
                      persistido y cerrará el circuito solo si sigue vigente y
                      corresponde a esta Conexión.
                    </p>
                    <label className="flex items-center gap-2">
                      <input
                        checked={causeFixed}
                        onChange={(event) =>
                          setCauseFixed(event.target.checked)
                        }
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
                      className="bg-warning text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
                      disabled={
                        !causeFixed ||
                        !manualConfirmation ||
                        !reactivationEvidence.valid ||
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
                      Reactivar con evidencia E2E
                    </button>
                    {!reactivationEvidence.valid ? (
                      <p
                        className="text-warning-foreground text-xs"
                        role="status"
                      >
                        {reactivationEvidence.reason}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {reactivateCircuitBreaker.error ? (
                  <p className="text-warning-foreground text-sm" role="alert">
                    {reactivateCircuitBreaker.error.message}
                  </p>
                ) : null}
                <div className="border-border space-y-2 border-t pt-3">
                  <p className="text-sm font-medium">Abrir corte operativo</p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                    <select
                      className="border-border bg-muted rounded border p-2 text-sm"
                      onChange={(event) =>
                        setOpenCause(event.target.value as typeof openCause)
                      }
                      value={openCause}
                    >
                      <option value="provider-error">Error persistente</option>
                      <option value="webhook-paused">Webhook pausado</option>
                      <option value="high-failure-rate">
                        Tasa alta de fallos
                      </option>
                      <option value="credit-exhausted">Crédito agotado</option>
                      <option value="quota-exhausted">Cuota agotada</option>
                      <option value="meta-error">Error de Meta</option>
                      <option value="legal-block">Bloqueo legal</option>
                    </select>
                    <input
                      className="border-border bg-muted rounded border p-2 text-sm"
                      onChange={(event) => setOpenReason(event.target.value)}
                      placeholder="Motivo operativo"
                      value={openReason}
                    />
                  </div>
                  <button
                    className="border-warning-border text-warning-foreground rounded border px-3 py-2 text-sm disabled:opacity-50"
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
                    <p className="text-warning-foreground text-sm" role="alert">
                      {openCircuitBreaker.error.message}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        </SupervisionTechnicalDetails>
        <details
          className="border-border bg-card rounded-xl border p-4"
          id="whatsapp-onboarding"
          open={!connectionReady}
        >
          <summary className="cursor-pointer font-semibold">
            Conexión de WhatsApp
          </summary>
          <section
            aria-labelledby="whatsapp-onboarding-title"
            className="border-primary/30 mt-4 space-y-3 rounded-xl border p-5"
          >
            <div>
              <h2
                className="text-xl font-semibold"
                id="whatsapp-onboarding-title"
              >
                Conexión y preparación de WhatsApp
              </h2>
              <p className="text-foreground mt-1 text-sm">
                Comprueba las condiciones operativas de la Clínica. No se
                guardan OTP, QR, documentos ni credenciales, y este paso no
                ejecuta acciones de Meta por el Médico.
              </p>
            </div>
            <label className="block text-sm" htmlFor="whatsapp-owner-name">
              Médico propietario confirmado
              <input
                autoComplete="off"
                className="border-border bg-muted mt-1 w-full rounded border p-2"
                id="whatsapp-owner-name"
                onChange={(event) => setOnboardingOwnerName(event.target.value)}
                placeholder="Nombre del Médico propietario"
                value={onboardingOwnerName}
              />
            </label>
            <label className="block text-sm" htmlFor="whatsapp-phone-number">
              Número de WhatsApp propio
              <input
                autoComplete="off"
                className="border-border bg-muted mt-1 w-full rounded border p-2"
                id="whatsapp-phone-number"
                inputMode="tel"
                onChange={(event) => setPhoneNumberE164(event.target.value)}
                placeholder="Formato internacional, por ejemplo +50370000000"
                type="tel"
                value={phoneNumberE164}
              />
            </label>
            <label className="block text-sm">
              Modalidad de WhatsApp
              <select
                className="border-border bg-muted mt-1 w-full rounded border p-2"
                onChange={(event) =>
                  setOnboardingMode(
                    event.target.value as WhatsAppOnboardingMode,
                  )
                }
                value={onboardingMode}
              >
                <option value="coexistence">Coexistence (app y API)</option>
                <option value="dedicated">Dedicated (solo API)</option>
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
                onChange={(event) =>
                  setNumberOwnedByClinic(event.target.checked)
                }
                type="checkbox"
              />
              El número es propio de la Clínica
            </label>
            {onboardingMode === "dedicated" && (
              <p className="text-foreground text-sm">
                Dedicated usa el número por API. El número debe poder recibir la
                verificación de Meta; no estará disponible en WhatsApp Business
                App.
              </p>
            )}
            {onboardingMode === "coexistence" && (
              <label className="block text-sm">
                WhatsApp instalado en el número
                <select
                  className="border-border bg-muted mt-1 w-full rounded border p-2"
                  onChange={(event) =>
                    setWhatsappBusinessApp(
                      event.target.value as
                        | "active"
                        | "messenger-only"
                        | "not-installed"
                        | "not-willing",
                    )
                  }
                  value={whatsappBusinessApp}
                >
                  <option value="active">WhatsApp Business App activa</option>
                  <option value="not-installed">No está instalada</option>
                  <option value="messenger-only">
                    Solo WhatsApp Messenger
                  </option>
                  <option value="not-willing">
                    No desea mantener WhatsApp Business App
                  </option>
                </select>
              </label>
            )}
            <label className="block text-sm">
              Autoridad Meta
              <select
                className="border-border bg-muted mt-1 w-full rounded border p-2"
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
            {onboardingMode === "coexistence" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={qrDeviceAvailable}
                  onChange={(event) =>
                    setQrDeviceAvailable(event.target.checked)
                  }
                  type="checkbox"
                />
                Hay un dispositivo para mostrar y completar el QR
              </label>
            )}
            <button
              className="bg-primary text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
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
              <p className="text-warning-foreground text-sm" role="alert">
                {prepareOnboarding.error.message}
              </p>
            ) : null}
            {onboarding.isLoading ? (
              <p className="text-foreground text-sm" role="status">
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
                  <p className="text-warning-foreground text-sm" role="alert">
                    {manageSetupLink.error.message}
                  </p>
                ) : null}
              </>
            ) : clinicId ? (
              <p className="text-foreground text-sm">
                Todavía no hay un preflight ejecutado para esta Clínica.
              </p>
            ) : null}
          </section>
        </details>
        <details
          className="border-border bg-card rounded-xl border p-4"
          id="whatsapp-readiness"
          open={connectionReady && !readinessReady}
        >
          <summary className="cursor-pointer font-semibold">
            Preparación técnica de WhatsApp
          </summary>
          <div className="mt-4 space-y-3 text-sm">
            <section
              aria-labelledby="whatsapp-readiness-title"
              className="border-primary/30 space-y-4 rounded-xl border p-5"
              data-whatsapp-readiness-operations="true"
            >
              <div>
                <h2
                  className="text-xl font-semibold"
                  id="whatsapp-readiness-title"
                >
                  Readiness técnico de WhatsApp
                </h2>
                <p className="text-foreground mt-1 text-sm">
                  Solo una Conexión con número, webhooks, plantillas, billing y
                  E2E correctos pasa a <code>ready</code>. Estos gates no
                  autorizan datos reales ni sustituyen Consentimiento,
                  privacidad o el gate legal.
                </p>
              </div>
              {!clinicId ? (
                <p className="text-muted-foreground text-sm">
                  Seleccione una Clínica para consultar sus gates.
                </p>
              ) : readiness.isLoading ? (
                <p className="text-foreground text-sm" role="status">
                  Consultando readiness…
                </p>
              ) : readiness.error ? (
                <p className="text-warning-foreground text-sm" role="alert">
                  {readiness.error.message}
                </p>
              ) : readiness.data?.connection === null ? (
                <p className="text-foreground text-sm">
                  La Clínica todavía no tiene una Conexión de WhatsApp. Complete
                  el enlace de configuración antes de reintentar readiness.
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
                      value={
                        readiness.data.numberHealth === "limited"
                          ? "Limitada (mensajería disponible)"
                          : readiness.data.numberHealth
                      }
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
                  <div
                    className="border-border bg-muted rounded-lg border p-3"
                    data-whatsapp-readiness-reconciliation="true"
                  >
                    <p className="font-medium">Reconciliación automática</p>
                    <dl className="text-foreground mt-2 grid gap-2 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                          Estado
                        </dt>
                        <dd className="mt-1">
                          {apoloReadinessReconciliationStatusLabel(
                            readiness.data.reconciliation.status,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                          Intentos
                        </dt>
                        <dd className="mt-1">
                          {readiness.data.reconciliation.attempts}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                          Próxima ejecución
                        </dt>
                        <dd className="mt-1">
                          {readiness.data.reconciliation.nextAttemptAt === null
                            ? "No programada"
                            : formatDateTime(
                                readiness.data.reconciliation.nextAttemptAt,
                              )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                          Último intento
                        </dt>
                        <dd className="mt-1">
                          {readiness.data.reconciliation.lastAttemptAt === null
                            ? "Sin intentos"
                            : formatDateTime(
                                readiness.data.reconciliation.lastAttemptAt,
                              )}
                        </dd>
                      </div>
                    </dl>
                    {readiness.data.reconciliation.lastError !== null ? (
                      <p
                        className="text-warning-foreground mt-2 text-sm"
                        role="alert"
                      >
                        {readiness.data.reconciliation.lastError}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="border-border bg-muted rounded-lg border p-3">
                      <p className="font-medium">Billing atribuido</p>
                      <dl className="text-foreground mt-2 space-y-1">
                        <div>
                          <dt className="inline">Modo: </dt>
                          <dd className="inline">
                            {readiness.data.billing.mode}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Funding del WABA: </dt>
                          <dd className="inline">
                            {kapsoFundingStatusLabel(
                              readiness.data.billing.kapsoFundingStatus,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Mensajes pagados: </dt>
                          <dd className="inline">
                            {readiness.data.billing.kapsoPaidMessagesPaused ===
                            false
                              ? "Activos en Kapso"
                              : readiness.data.billing
                                    .kapsoPaidMessagesPaused === true
                                ? "Pausados en Kapso"
                                : "Estado no reportado"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Crédito: </dt>
                          <dd className="inline">
                            {readiness.data.billing.creditBalanceKnown === true
                              ? formatCents(readiness.data.billing.creditCents)
                              : "Saldo no expuesto por API"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Reserva de crédito: </dt>
                          <dd className="inline">
                            {readiness.data.billing.creditBalanceKnown === true
                              ? formatCents(
                                  readiness.data.billing.creditReserveCents ??
                                    0,
                                )
                              : "No disponible por API"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Crédito en vuelo: </dt>
                          <dd className="inline">
                            {readiness.data.billing.creditBalanceKnown === true
                              ? formatCents(
                                  readiness.data.billing.creditInFlightCents ??
                                    0,
                                )
                              : "No disponible por API"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Salud: </dt>
                          <dd className="inline">
                            {readiness.data.billing.creditBalanceKnown === true
                              ? billingHealthLabel(
                                  readiness.data.billingHealth.level,
                                )
                              : "Saldo no consultable por API"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Autonomía estimada: </dt>
                          <dd className="inline">
                            {readiness.data.billing.creditBalanceKnown !== true
                              ? "No disponible por API"
                              : readiness.data.billingHealth.autonomyDays ===
                                  null
                                ? "No estimada"
                                : `${readiness.data.billingHealth.autonomyDays} días`}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Cuota Kapso: </dt>
                          <dd className="inline">
                            {readiness.data.billing.kapsoMonthlyQuota == null
                              ? "No consultable por API"
                              : `${readiness.data.billing.kapsoQuotaConsumed} / ${readiness.data.billing.kapsoMonthlyQuota} mensajes${readiness.data.billing.kapsoQuotaInFlight === undefined ? "" : ` · ${readiness.data.billing.kapsoQuotaInFlight} en vuelo`}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Consumo: </dt>
                          <dd className="inline">
                            {readiness.data.billing.creditBalanceKnown === true
                              ? formatCents(
                                  readiness.data.billing.consumedCents,
                                )
                              : "No disponible por API"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Umbral de alerta: </dt>
                          <dd className="inline">
                            {readiness.data.billing.alertThresholdCents === null
                              ? readiness.data.billing.kapsoFundingStatus !=
                                null
                                ? "No disponible por API"
                                : "No registrado"
                              : formatCents(
                                  readiness.data.billing.alertThresholdCents,
                                )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Cargos separados: </dt>
                          <dd className="inline">
                            {readiness.data.billing.kapsoFundingStatus != null
                              ? readiness.data.billing.kapsoFundingStatus ===
                                "funded"
                                ? "Kapso gestiona los cargos de Meta"
                                : "No confirmado por API"
                              : readiness.data.billing.chargesSeparated
                                ? "Sí"
                                : "No"}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Cargos de Meta: </dt>
                          <dd className="inline">
                            {readiness.data.billing.metaChargesCents == null
                              ? readiness.data.billing.kapsoFundingStatus !=
                                null
                                ? "No disponibles por API"
                                : "No registrados"
                              : formatCents(
                                  readiness.data.billing.metaChargesCents,
                                )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Cargos de plataforma: </dt>
                          <dd className="inline">
                            {readiness.data.billing.platformChargesCents == null
                              ? readiness.data.billing.kapsoFundingStatus !=
                                null
                                ? "No disponibles por API"
                                : "No registrados"
                              : formatCents(
                                  readiness.data.billing.platformChargesCents,
                                )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="border-border bg-muted rounded-lg border p-3">
                      <p className="font-medium">Plantillas críticas</p>
                      <ul className="text-foreground mt-2 space-y-1">
                        {readiness.data.templates.map((template) => (
                          <li key={template.kind}>
                            {template.name} · v{template.catalogVersion ?? "?"}{" "}
                            · {template.locale || "sin locale"} ·{" "}
                            {template.category ?? "sin categoría"} ·{" "}
                            {whatsappTemplateProvisioningStatusLabel(
                              template.provisioningStatus,
                              template.status,
                            )}
                            {template.rejectionReason
                              ? ` · ${template.rejectionReason}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {readiness.data.alerts?.some(
                    (alert) => alert.status === "open",
                  ) ? (
                    <div
                      className="border-destructive/30 bg-destructive/10 rounded-lg border p-4"
                      data-whatsapp-connection-alerts="true"
                      role="alert"
                    >
                      <p className="text-destructive font-medium">
                        Alertas operativas de WhatsApp
                      </p>
                      <ul className="text-destructive mt-2 space-y-2 text-sm">
                        {readiness.data.alerts
                          .filter((alert) => alert.status === "open")
                          .map((alert) => (
                            <li key={alert.id}>
                              <span className="font-medium">
                                {apoloReadinessGateLabel(alert.gateCode)}:
                              </span>{" "}
                              {alert.reason}{" "}
                              <span className="text-destructive">
                                Siguiente acción: {alert.nextAction}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                  <ul
                    className="space-y-3"
                    data-whatsapp-readiness-gates="true"
                  >
                    {readiness.data.readiness.gates.map((gate) => (
                      <li
                        className="border-border bg-muted rounded-lg border p-3"
                        key={gate.code}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {apoloReadinessGateLabel(gate.code)}
                          </span>
                          <span className="text-foreground text-xs tracking-wide uppercase">
                            {gate.status}
                          </span>
                        </div>
                        <p className="text-foreground mt-1 text-sm">
                          {gate.message}
                        </p>
                        {gate.code === "webhooks" ||
                        gate.code === "templates" ||
                        gate.code === "billing" ||
                        gate.code === "e2e" ||
                        (gate.code === "number" &&
                          (readiness.data.connection?.status === "blocked" ||
                            readiness.data.connection?.status ===
                              "degraded")) ||
                        gate.action ===
                          "Reactivar manualmente la Conexión de WhatsApp" ? (
                          <button
                            className="border-primary/30 text-primary mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50"
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
                  <p className="border-warning-border bg-warning-muted text-warning-foreground rounded-lg border p-3 text-sm">
                    {readiness.data.readiness.legalAuthorization.message}
                  </p>
                  {retryReadiness.error ? (
                    <p className="text-warning-foreground text-sm" role="alert">
                      {retryReadiness.error.message}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-foreground text-sm">
                  La Clínica todavía no tiene una Conexión de WhatsApp.
                </p>
              )}
            </section>
          </div>
        </details>
        <section
          aria-labelledby="whatsapp-final-operations-title"
          className="border-destructive/30 space-y-4 rounded-xl border p-5"
          data-whatsapp-final-operations="true"
          id="whatsapp-final-operations"
        >
          <div>
            <h2
              className="text-xl font-semibold"
              id="whatsapp-final-operations-title"
            >
              Prueba y habilitación de tráfico
            </h2>
            <p className="text-foreground mt-1 text-sm">
              El smoke de Kapso usa un Contacto existente sin vínculo a
              Paciente. El roundtrip vence en cinco minutos, registra pasos por
              Clínica y no habilita Pacientes reales. La autorización de tráfico
              real permanece sujeta a sus gates y confirmación explícita.
            </p>
          </div>
          {!clinicId ? (
            <p className="text-muted-foreground text-sm">
              Seleccione una Clínica para operar el piloto.
            </p>
          ) : whatsappOperations.isLoading ? (
            <p className="text-foreground text-sm" role="status">
              Consultando controles de tráfico…
            </p>
          ) : whatsappOperations.error ? (
            <p className="text-warning-foreground text-sm" role="alert">
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
                    whatsappOperations.data.technicalReadiness.status ===
                    "ready"
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
              <details
                className="border-border bg-card rounded-lg border p-4"
                id="whatsapp-smoke"
                open={readinessReady && !smokePassed}
              >
                <summary className="cursor-pointer font-semibold">
                  Prueba controlada de WhatsApp
                </summary>
                <div className="bg-muted mt-3 rounded-lg p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Smoke E2E sintético</h3>
                      <p className="text-foreground mt-1 text-sm">
                        Combina contratos locales, preflight del webhook de
                        Kapso y un roundtrip firmado con un Contacto de prueba.
                        La respuesta aceptada sigue pendiente hasta que llegue
                        el callback de entrega.
                      </p>
                    </div>
                    {whatsappOperations.data.connection?.provider ===
                    "kapso" ? (
                      <label className="grid min-w-64 gap-1 text-sm">
                        <span>Teléfono E.164 del Contacto de prueba</span>
                        <input
                          autoComplete="off"
                          className="border-border bg-background text-foreground rounded border px-3 py-2"
                          inputMode="tel"
                          onChange={(event) =>
                            setSmokeTestPhone(event.target.value)
                          }
                          placeholder="+50370000000"
                          type="tel"
                          value={smokeTestPhone}
                        />
                        <span className="text-muted-foreground text-xs">
                          Debe existir en esta Clínica y no estar vinculado a un
                          Paciente.
                        </span>
                      </label>
                    ) : null}
                    <button
                      className="bg-primary text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
                      disabled={
                        runSyntheticSmoke.isPending ||
                        whatsappOperations.data.latestSmoke?.status ===
                          "pending" ||
                        (whatsappOperations.data.connection?.provider ===
                          "kapso" &&
                          !isValidE164PhoneNumber(smokeTestPhone.trim()))
                      }
                      onClick={() =>
                        runSyntheticSmoke.mutate({
                          clinicId,
                          ...(whatsappOperations.data.connection?.provider ===
                          "kapso"
                            ? { testContactPhoneE164: smokeTestPhone.trim() }
                            : {}),
                        })
                      }
                      type="button"
                    >
                      {runSyntheticSmoke.isPending
                        ? "Ejecutando…"
                        : whatsappOperations.data.latestSmoke?.status ===
                            "pending"
                          ? "Smoke en curso"
                          : whatsappOperations.data.connection?.provider ===
                              "kapso"
                            ? "Ejecutar smoke de transporte"
                            : "Ejecutar smoke sintético"}
                    </button>
                  </div>
                  {whatsappOperations.data.latestSmoke ? (
                    <>
                      <p className="mt-3 text-sm">
                        Resultado:{" "}
                        <strong>
                          {whatsappOperations.data.latestSmoke.status ===
                          "passed"
                            ? "aprobado"
                            : whatsappOperations.data.latestSmoke.status ===
                                "pending"
                              ? "esperando roundtrip"
                              : "fallido"}
                        </strong>{" "}
                        · Contacto de prueba controlado:{" "}
                        {whatsappOperations.data.latestSmoke
                          .controlledTestContact
                          ? "sí"
                          : "no"}{" "}
                        · Pacientes reales habilitados:{" "}
                        {whatsappOperations.data.latestSmoke.realPatientsEnabled
                          ? "sí"
                          : "no"}
                      </p>
                      {whatsappOperations.data.latestSmoke
                        .requireRealRoundtrip ? (
                        <dl className="text-foreground mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="text-muted-foreground">
                              ID del run
                            </dt>
                            <dd className="font-mono">
                              {whatsappOperations.data.latestSmoke.id}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Contacto controlado
                            </dt>
                            <dd>
                              {whatsappOperations.data.latestSmoke
                                .testContactMaskedPhone ??
                                "Teléfono no disponible"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Inicio / timeout
                            </dt>
                            <dd>
                              {formatDateTime(
                                whatsappOperations.data.latestSmoke.startedAt,
                              )}{" "}
                              /{" "}
                              {whatsappOperations.data.latestSmoke.timeoutAt
                                ? formatDateTime(
                                    whatsappOperations.data.latestSmoke
                                      .timeoutAt,
                                  )
                                : "sin timeout"}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                      {whatsappOperations.data.latestSmoke.status ===
                        "pending" &&
                      whatsappOperations.data.latestSmoke
                        .requireRealRoundtrip ? (
                        <p className="border-warning-border bg-warning-muted text-warning-foreground mt-3 rounded border p-3 text-sm">
                          Desde el Contacto indicado, envíe a la Clínica este
                          código:{" "}
                          <code className="font-mono font-semibold">
                            PRUEBA WHATSAPP{" "}
                            {whatsappOperations.data.latestSmoke.id}
                          </code>
                        </p>
                      ) : null}
                      <ul className="text-foreground mt-3 grid gap-2 text-xs sm:grid-cols-2">
                        {whatsappOperations.data.latestSmoke.steps.map(
                          (step) => (
                            <li key={step.code}>
                              <span
                                className={
                                  step.status === "passed"
                                    ? "text-primary"
                                    : step.status === "pending"
                                      ? "text-warning-foreground"
                                      : step.status === "skipped"
                                        ? "text-muted-foreground"
                                        : "text-destructive"
                                }
                              >
                                {step.status === "passed"
                                  ? "✓"
                                  : step.status === "pending"
                                    ? "…"
                                    : step.status === "skipped"
                                      ? "–"
                                      : "✕"}{" "}
                                {whatsappSyntheticSmokeStepLabels[step.code]}
                              </span>
                              {step.message ? " · " + step.message : ""}
                              {step.evidence ? " · " + step.evidence : ""}
                              {step.source
                                ? ` · ${step.source === "provider" ? "Kapso" : "Praxia"}`
                                : ""}
                              {step.eventId ? ` · ${step.eventId}` : ""}
                              {step.observedAt
                                ? ` · ${formatDateTime(step.observedAt)}`
                                : ""}
                            </li>
                          ),
                        )}
                      </ul>
                      {whatsappOperations.data.latestSmoke.blockers.length >
                      0 ? (
                        <ul className="text-warning-foreground mt-3 list-disc space-y-1 pl-5 text-sm">
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
                    <p className="text-warning-foreground mt-3 text-sm">
                      Todavía no existe evidencia de smoke sintético.
                    </p>
                  )}
                  {runSyntheticSmoke.error ? (
                    <p
                      className="text-warning-foreground mt-2 text-sm"
                      role="alert"
                    >
                      {runSyntheticSmoke.error.message}
                    </p>
                  ) : null}
                </div>
              </details>
              <details
                className="border-warning-border bg-warning-muted space-y-3 rounded-lg border p-4"
                open={smokePassed && !trafficEnabled}
                id="whatsapp-real-traffic"
              >
                <summary className="cursor-pointer font-semibold">
                  Autorización y habilitación de tráfico real
                </summary>
                <div id="whatsapp-traffic-gates">
                  <h3 className="font-semibold">Evidencia de los gates</h3>
                  <p className="text-foreground mt-1 text-sm">
                    Registre una referencia operativa breve por gate. No
                    introduzca PII, tokens, QR ni credenciales.
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
                            <span className="text-foreground block">
                              {whatsappRealTrafficGateLabel(code)}
                            </span>
                            <input
                              className="border-border bg-background mt-1 w-full rounded border p-2"
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
                            className="border-primary/30 text-primary rounded border px-3 py-2 text-sm disabled:opacity-50"
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
                    <p
                      className="text-warning-foreground mt-2 text-sm"
                      role="alert"
                    >
                      {recordTrafficGate.error.message}
                    </p>
                  ) : null}
                </div>
                <div className="border-warning-border bg-warning-muted rounded-lg border p-4">
                  <h3 className="font-semibold">Habilitación explícita</h3>
                  <ul className="text-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
                    {whatsappOperations.data.trafficEvaluation.blockers
                      .length === 0 ? (
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
                      className="bg-warning text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
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
                      className="border-destructive/30 text-destructive rounded border px-3 py-2 disabled:opacity-50"
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
                    <p
                      className="text-warning-foreground mt-2 text-sm"
                      role="alert"
                    >
                      {
                        (enableRealTraffic.error ?? revertRealTraffic.error)
                          ?.message
                      }
                    </p>
                  ) : null}
                </div>
              </details>
              <details className="border-destructive/30 bg-destructive/10 rounded-xl border p-4">
                <summary className="text-destructive cursor-pointer font-semibold">
                  Retirada de WhatsApp · operación excepcional
                </summary>
                <div className="mt-4">
                  <div className="border-destructive/30 bg-destructive/10 rounded-lg border p-4">
                    <h3 className="font-semibold">Retirar la Conexión</h3>
                    <p className="text-foreground mt-1 text-sm">
                      Detiene nuevos envíos, cancela las Entregas pendientes
                      elegibles, desconecta y desactiva los webhooks de Kapso.
                      Revoca los enlaces de configuración de Praxia y exporta la
                      configuración permitida. No elimina el número, WABA,
                      plantillas ni historial administrativo. Cada paso queda
                      auditado y los fallos pueden reintentarse.
                    </p>
                    <p className="text-foreground mt-2 text-sm">
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
                      className="bg-destructive/10 text-primary-foreground mt-3 rounded px-3 py-2 font-medium disabled:opacity-50"
                      disabled={
                        !offboardingConfirmation ||
                        whatsappOperations.data.offboardingAuthorization ===
                          null ||
                        offboardConnection.isPending
                      }
                      onClick={() =>
                        offboardConnection.mutate({
                          clinicId,
                          manualConfirmation: true,
                        })
                      }
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
                        <ul className="text-foreground space-y-1">
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
                          <summary className="text-primary cursor-pointer">
                            Ver exportación de configuración permitida
                          </summary>
                          <pre className="bg-background text-foreground mt-2 max-h-56 overflow-auto rounded p-3 text-xs">
                            {JSON.stringify(
                              whatsappOperations.data.offboarding
                                .configurationExport,
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                        <button
                          className="border-border rounded border px-3 py-2 text-sm"
                          onClick={() =>
                            downloadWhatsAppConfigurationExport(
                              clinicId,
                              whatsappOperations.data.offboarding
                                ?.configurationExport ?? {},
                            )
                          }
                          type="button"
                        >
                          Descargar exportación permitida
                        </button>
                      </div>
                    ) : null}
                    {offboardConnection.error ? (
                      <p
                        className="text-warning-foreground mt-2 text-sm"
                        role="alert"
                      >
                        {offboardConnection.error.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              </details>
            </>
          ) : null}
        </section>
        {activeTab === "whatsapp" ? (
          <details className="border-border bg-card rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">
              Evidencia avanzada de activación
            </summary>
            <div className="mt-4">
              <WhatsAppActivationClosureSection
                clinicId={clinicId}
                refreshToken={activationRefreshToken}
              />
            </div>
          </details>
        ) : null}
      </section>
      <section
        aria-labelledby="supervision-tab-payments"
        className="space-y-5"
        hidden={activeTab !== "payments"}
        id="supervision-panel-payments"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="border-border space-y-4 rounded-xl border p-5">
            <h2 className="text-xl font-semibold">Pago por transferencia</h2>
            <div className="bg-muted rounded-lg p-3 text-sm">
              <p className="font-medium">Revisa antes de registrar</p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <DiagnosticValue
                  label="Clínica"
                  value={selectedClinic?.name ?? "Selecciona una Clínica"}
                />
                <DiagnosticValue
                  label="Suscripción actual"
                  value={subscriptionStatusLabel(
                    selectedClinic?.subscriptionStatus ?? null,
                  )}
                />
                <DiagnosticValue
                  label="Importe"
                  value={`$${amountUsd || "—"}`}
                />
                <DiagnosticValue label="Referencia" value={reference || "—"} />
                <DiagnosticValue
                  label="Último pago registrado"
                  value={
                    recentPayments.data?.[0]
                      ? `$${recentPayments.data[0].amountUsd} · ${recentPayments.data[0].reference} · ${formatDateTime(recentPayments.data[0].recordedAt)}`
                      : recentPayments.isLoading
                        ? "Consultando historial…"
                        : "Sin pagos previos"
                  }
                />
              </dl>
            </div>
            <label className="block text-sm" htmlFor="payment-amount">
              Monto en USD
              <input
                aria-describedby="payment-amount-help"
                className="border-border bg-muted mt-1 w-full rounded border p-2"
                id="payment-amount"
                inputMode="decimal"
                onChange={(event) => setAmountUsd(event.target.value)}
                placeholder="75.00"
                value={amountUsd}
              />
            </label>
            <p
              className="text-muted-foreground text-xs"
              id="payment-amount-help"
            >
              Usa dos decimales y un monto mayor que cero.
            </p>
            <label className="block text-sm" htmlFor="payment-reference">
              Referencia de transferencia
              <input
                className="border-border bg-muted mt-1 w-full rounded border p-2"
                id="payment-reference"
                onChange={(event) => setReference(event.target.value)}
                placeholder="TRX-001"
                value={reference}
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                checked={paymentReview === paymentFingerprint}
                className="mt-1"
                onChange={(event) =>
                  setPaymentReview(
                    event.target.checked ? paymentFingerprint : null,
                  )
                }
                type="checkbox"
              />
              Confirmo que Clínica, importe y referencia corresponden al pago
              recibido.
            </label>
            <button
              className="bg-primary text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
              disabled={
                !paymentInputValid ||
                paymentReview !== paymentFingerprint ||
                recordPayment.isPending
              }
              onClick={submitPayment}
              type="button"
            >
              {paymentFeedback.status === "failed"
                ? "Reintentar de forma segura"
                : recordPayment.isPending
                  ? "Procesando…"
                  : "Confirmar y registrar pago"}
            </button>
            <AdministrativeOperationFeedback feedback={paymentFeedback} />
            {paymentFeedback.status === "succeeded" && recordPayment.data ? (
              <p className="text-primary text-sm" role="status">
                Pago registrado. ID: {recordPayment.data.paymentId} ·{" "}
                {formatDateTime(recordPayment.data.recordedAt)}
              </p>
            ) : null}
            <div aria-labelledby="recent-payments-title" className="space-y-2">
              <h3 className="font-medium" id="recent-payments-title">
                Últimos pagos
              </h3>
              {!clinicId ? (
                <p className="text-muted-foreground text-sm">
                  Selecciona una Clínica para ver su historial.
                </p>
              ) : recentPayments.isLoading ? (
                <p className="text-muted-foreground text-sm" role="status">
                  Consultando pagos…
                </p>
              ) : recentPayments.error ? (
                <p className="text-warning-foreground text-sm" role="alert">
                  {recentPayments.error.message}
                </p>
              ) : recentPayments.data?.length ? (
                <ol className="divide-border border-border divide-y rounded-lg border">
                  {recentPayments.data.map((payment) => (
                    <li
                      className="flex flex-wrap justify-between gap-2 p-3 text-sm"
                      key={payment.id}
                    >
                      <span>
                        ${payment.amountUsd} · {payment.reference}
                      </span>
                      <time dateTime={payment.recordedAt.toISOString()}>
                        {formatDateTime(payment.recordedAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No hay pagos registrados para esta Clínica.
                </p>
              )}
            </div>
          </section>
          <section className="border-border space-y-4 rounded-xl border p-5">
            <h2 className="text-xl font-semibold">Suscripción</h2>
            <div className="bg-muted rounded-lg p-3">
              <p className="text-muted-foreground text-sm">Estado actual</p>
              <p className="mt-1 text-lg font-semibold">
                {subscriptionStatusLabel(
                  selectedClinic?.subscriptionStatus ?? null,
                )}
              </p>
              <p className="text-foreground mt-1 text-sm">
                La acción disponible se ajusta al estado de la Clínica.
              </p>
            </div>
            <p className="text-foreground text-sm">
              Los reintentos conservan la misma operación administrativa.
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedClinic?.subscriptionStatus === "active" ? (
                <button
                  className="border-warning-border rounded border px-3 py-2 disabled:opacity-50"
                  disabled={setSubscription.isPending}
                  onClick={() => submitSubscription("suspended")}
                  type="button"
                >
                  Suspender suscripción
                </button>
              ) : selectedClinic?.subscriptionStatus === "suspended" ? (
                <button
                  className="border-primary/30 rounded border px-3 py-2 disabled:opacity-50"
                  disabled={setSubscription.isPending}
                  onClick={() => submitSubscription("active")}
                  type="button"
                >
                  Activar suscripción
                </button>
              ) : null}
            </div>
            <AdministrativeOperationFeedback feedback={subscriptionFeedback} />
            {subscriptionFeedback.status === "succeeded" &&
            setSubscription.data ? (
              <p className="text-primary text-sm" role="status">
                Suscripción actualizada a{" "}
                {setSubscription.data.subscriptionStatus}. Operación:{" "}
                {setSubscription.data.operationKey}
              </p>
            ) : null}
          </section>
        </div>
        <SupervisionTechnicalDetails summary="Diagnóstico técnico de Pagos">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DiagnosticValue
              label="Estado del pago"
              value={getSupervisionOperationStatusLabel(
                recordPayment.status,
                operationStatusLabels,
              )}
            />
            <DiagnosticValue
              label="Clave de operación del pago"
              value={paymentAttempt?.key ?? "Sin operación generada"}
            />
            <DiagnosticValue
              label="ID del pago registrado"
              value={recordPayment.data?.paymentId ?? "No disponible"}
            />
            <DiagnosticValue
              label="Estado de suscripción"
              value={getSupervisionOperationStatusLabel(
                setSubscription.status,
                operationStatusLabels,
              )}
            />
            <DiagnosticValue
              label="Clave de operación de suscripción"
              value={subscriptionAttempt?.key ?? "Sin operación generada"}
            />
            <DiagnosticValue
              label="Suscripción registrada"
              value={
                setSubscription.data?.subscriptionStatus ?? "No disponible"
              }
            />
          </dl>
          {recordPayment.error ? (
            <p className="text-warning-foreground break-words">
              Error de pago: {recordPayment.error.message}
            </p>
          ) : null}
          {setSubscription.error ? (
            <p className="text-warning-foreground break-words">
              Error de suscripción: {setSubscription.error.message}
            </p>
          ) : null}
        </SupervisionTechnicalDetails>
      </section>
      <section
        aria-labelledby="supervision-tab-support"
        className="space-y-5"
        hidden={activeTab !== "support"}
        id="supervision-panel-support"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="border-warning-border space-y-4 rounded-xl border p-5">
            <h2 className="text-xl font-semibold">Soporte con vencimiento</h2>
            <p className="text-foreground text-sm">
              El acceso queda limitado a esta Clínica y se audita al consultar
              sus datos. El vencimiento se fija al abrir la sesión.
            </p>
            <label className="block text-sm" htmlFor="support-reason">
              Motivo de soporte
              <textarea
                className="border-border bg-muted mt-1 min-h-20 w-full rounded border p-2"
                id="support-reason"
                onChange={(event) => setReason(event.target.value)}
                placeholder="Motivo de soporte"
                value={reason}
              />
            </label>
            <label className="block text-sm" htmlFor="support-duration">
              Duración del acceso
              <select
                className="border-border bg-muted mt-1 w-full rounded border p-2"
                id="support-duration"
                onChange={(event) => {
                  const duration = event.target.value;
                  setSupportDurationMinutes(duration);
                  setExpiresAt(
                    toDateTimeLocalValue(
                      new Date(Date.now() + Number(duration) * 60_000),
                    ),
                  );
                }}
                value={supportDurationMinutes}
              >
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="240">4 horas</option>
              </select>
            </label>
            <p className="text-muted-foreground text-sm">
              Vence: {formatDateTime(supportExpiresAt)}
            </p>
            <button
              className="bg-warning text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
              disabled={!supportInputValid || openSupport.isPending}
              onClick={submitSupport}
              type="button"
            >
              {supportFeedback.status === "failed"
                ? "Reintentar de forma segura"
                : openSupport.isPending
                  ? "Procesando…"
                  : "Abrir soporte auditado"}
            </button>
            <AdministrativeOperationFeedback feedback={supportFeedback} />
            {readSupport.error ? (
              <p className="text-warning-foreground text-sm" role="alert">
                {readSupport.error.message}
              </p>
            ) : null}
            {readSupport.data ? (
              <p className="text-foreground text-sm" role="status">
                {readSupport.data.name}: {readSupport.data.subscriptionStatus}
              </p>
            ) : null}
          </section>
          <section
            aria-labelledby="support-sessions-title"
            className="border-border space-y-4 rounded-xl border p-5"
          >
            <div>
              <h2 className="text-xl font-semibold" id="support-sessions-title">
                Sesiones de soporte recientes
              </h2>
              <p className="text-foreground mt-1 text-sm">
                Quién recibió acceso, su motivo y cuándo vence.
              </p>
            </div>
            {!clinicId ? (
              <p className="text-muted-foreground text-sm">
                Selecciona una Clínica para consultar sus sesiones.
              </p>
            ) : supportSessions.isLoading ? (
              <p className="text-muted-foreground text-sm" role="status">
                Consultando sesiones…
              </p>
            ) : supportSessions.error ? (
              <p className="text-warning-foreground text-sm" role="alert">
                {supportSessions.error.message}
              </p>
            ) : supportSessions.data?.length ? (
              <ul className="space-y-3">
                {supportSessions.data.map((session) => {
                  const active = session.expiresAt.getTime() > Date.now();
                  return (
                    <li
                      className="border-border bg-muted rounded-lg border p-3"
                      key={session.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={
                            active ? "text-primary" : "text-muted-foreground"
                          }
                        >
                          {active ? "Activa" : "Vencida"}
                        </span>
                        <time
                          className="text-muted-foreground text-xs"
                          dateTime={session.createdAt.toISOString()}
                        >
                          Abierta {formatDateTime(session.createdAt)}
                        </time>
                      </div>
                      <p className="mt-2 font-medium">{session.reason}</p>
                      <p className="text-foreground mt-1 text-sm">
                        Acceso de identidad{" "}
                        <code className="font-mono text-xs">
                          {session.superadminIdentityId}
                        </code>
                      </p>
                      <p className="text-foreground mt-1 text-sm">
                        Vence {formatDateTime(session.expiresAt)}
                      </p>
                      {active && session.canOpen ? (
                        <button
                          className="border-warning-border mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50"
                          disabled={readSupport.isPending}
                          onClick={() => {
                            setSupportSessionId(session.id);
                            readSupport.mutate({
                              clinicId,
                              supportSessionId: session.id,
                            });
                          }}
                          type="button"
                        >
                          Consultar esta Clínica con acceso auditado
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No hay sesiones de soporte registradas para esta Clínica.
              </p>
            )}
          </section>
        </div>
        <SupervisionTechnicalDetails summary="Diagnóstico técnico de Soporte">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DiagnosticValue
              label="Estado de apertura"
              value={getSupervisionOperationStatusLabel(
                openSupport.status,
                operationStatusLabels,
              )}
            />
            <DiagnosticValue
              label="Clave de operación"
              value={supportAttempt?.key ?? "Sin operación generada"}
            />
            <DiagnosticValue
              label="ID de sesión"
              value={supportSessionId || "No disponible"}
            />
            <DiagnosticValue
              label="Vencimiento solicitado"
              value={expiresAt || "No especificado"}
            />
            <DiagnosticValue
              label="Estado de consulta"
              value={getSupervisionOperationStatusLabel(
                readSupport.status,
                supportQueryStatusLabels,
              )}
            />
          </dl>
          {openSupport.error ? (
            <p className="text-warning-foreground break-words">
              Error al abrir soporte: {openSupport.error.message}
            </p>
          ) : null}
          {readSupport.error ? (
            <p className="text-warning-foreground break-words">
              Error de consulta: {readSupport.error.message}
            </p>
          ) : null}
        </SupervisionTechnicalDetails>
      </section>
    </main>
  );
}

type AdministrativeOperationAttempt = {
  fingerprint: string;
  key: string | null;
};

function AdministrativeOperationFeedback({
  feedback,
}: {
  feedback: AdministrativeOperationFeedbackState;
}) {
  if (feedback.status === "idle") return null;
  if (feedback.status === "validation-pending") {
    return (
      <p className="text-warning-foreground text-sm" role="status">
        Validación pendiente: {feedback.message}
      </p>
    );
  }
  if (feedback.status === "pending") {
    return (
      <p className="text-foreground text-sm" role="status">
        {feedback.message}
      </p>
    );
  }
  if (feedback.status === "failed") {
    return (
      <p className="text-destructive text-sm" role="alert">
        {feedback.message} El reintento conserva la misma clave y no duplica la
        operación.
      </p>
    );
  }
  return (
    <p className="text-primary text-sm" role="status">
      Operación confirmada: {feedback.operationKey}
    </p>
  );
}

function WhatsAppActivationStages({
  authorizationDetail,
  connectionDetail,
  connectionReady,
  readinessDetail,
  readinessReady,
  smokeDetail,
  smokePassed,
  trafficAllowed,
  trafficEnabled,
}: {
  authorizationDetail: string;
  connectionDetail: string;
  connectionReady: boolean;
  readinessDetail: string;
  readinessReady: boolean;
  smokeDetail: string;
  smokePassed: boolean;
  trafficAllowed: boolean;
  trafficEnabled: boolean;
}) {
  const stages = [
    {
      complete: connectionReady,
      detail: connectionDetail,
      href: "#whatsapp-onboarding",
      label: "Conexión",
      pending: "Confirme el número y los datos de la Conexión.",
    },
    {
      complete: readinessReady,
      detail: readinessDetail,
      href: "#whatsapp-readiness",
      label: "Preparación técnica",
      pending: "Resuelva los gates de preparación que siguen pendientes.",
    },
    {
      complete: smokePassed,
      detail: smokeDetail,
      href: "#whatsapp-final-operations",
      label: "Prueba controlada",
      pending: "Ejecute y complete el smoke antes de autorizar tráfico.",
    },
    {
      complete: trafficAllowed,
      detail: authorizationDetail,
      href: "#whatsapp-final-operations",
      label: "Autorización",
      pending: "Registre la evidencia requerida por cada gate.",
    },
    {
      complete: trafficEnabled,
      detail: authorizationDetail,
      href: "#whatsapp-final-operations",
      label: "Habilitación",
      pending: "Confirme explícitamente la habilitación de tráfico real.",
    },
  ];
  const currentIndex = stages.findIndex((stage) => !stage.complete);
  const currentStage = stages[currentIndex];

  return (
    <div className="border-border bg-muted space-y-3 rounded-lg border p-4">
      <p className="text-muted-foreground text-sm" role="status">
        {currentStage
          ? `Etapa actual: ${currentStage.label}`
          : "Activación completada: tráfico real habilitado."}
      </p>
      {currentStage ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{currentStage.detail}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {currentStage.pending}
            </p>
          </div>
          <a
            className="bg-primary text-primary-foreground focus-visible:outline-ring rounded-lg px-4 py-2 font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            href={currentStage.href}
            onClick={() => {
              const detailsId =
                currentStage.label === "Prueba controlada"
                  ? "whatsapp-smoke"
                  : currentStage.label === "Autorización" ||
                      currentStage.label === "Habilitación"
                    ? "whatsapp-real-traffic"
                    : currentStage.href.slice(1);
              const target = document.getElementById(detailsId);
              if (target instanceof HTMLDetailsElement) target.open = true;
            }}
          >
            Abrir {currentStage.label.toLocaleLowerCase("es")}
          </a>
        </div>
      ) : null}
      {stages.slice(currentIndex < 0 ? stages.length : currentIndex + 1)
        .length ? (
        <p className="text-muted-foreground text-sm">
          Después:{" "}
          {stages
            .slice(currentIndex < 0 ? stages.length : currentIndex + 1)
            .map((stage) => stage.label)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function OnboardingSummary({
  snapshot,
}: {
  snapshot: {
    connection: {
      businessAccountId?: string | null;
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
    <div className="border-border bg-muted space-y-2 rounded-lg border p-4 text-sm">
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
          value={
            snapshot.connection?.businessAccountId ??
            snapshot.connection?.metadata.businessAccountId ??
            "Pendiente"
          }
        />
      </dl>
      {snapshot.connection?.metadata.statusReason ? (
        <p className="text-warning-foreground">
          Estado: {snapshot.connection.metadata.statusReason}
        </p>
      ) : null}
      {snapshot.connection?.metadata.nextAction ? (
        <p className="text-primary">
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
            <p className="text-warning-foreground">
              {snapshot.preflight.reason}
            </p>
          ) : null}
          {snapshot.preflight.blockers.length > 0 ? (
            <ul className="text-warning-foreground list-disc space-y-1 pl-5">
              {snapshot.preflight.blockers.map((blocker) => (
                <li key={`${blocker.message}-${blocker.nextAction}`}>
                  {blocker.message} {blocker.nextAction}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-primary">
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
      className="border-primary/30 bg-muted space-y-3 rounded-lg border p-4 text-sm"
      data-setup-link-operations="true"
    >
      <div>
        <h3 className="font-semibold" id="setup-link-operations-title">
          Enlace de configuración de WhatsApp
        </h3>
        <p className="text-foreground mt-1">
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
        <p className="text-foreground">
          No hay un enlace activo registrado para esta Clínica.
        </p>
      )}
      {snapshot.setupLinkProviderError !== null ? (
        <p className="text-warning-foreground" role="status">
          {snapshot.setupLinkProviderError}
        </p>
      ) : null}
      {snapshot.setupLinkHistory.length > 0 ? (
        <ol className="text-foreground space-y-2">
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
              className="border-primary/30 text-primary rounded border px-3 py-2 font-medium"
              href={setupLink.url}
              rel="noreferrer"
              target="_blank"
            >
              Abrir enlace
            </a>
            <button
              className="border-warning-border rounded border px-3 py-2 disabled:opacity-50"
              disabled={!preflightPassed || isPending}
              onClick={() => setPendingAction("revoke")}
              type="button"
            >
              Revocar enlace
            </button>
          </>
        ) : null}
        <button
          className="bg-primary text-primary-foreground rounded px-3 py-2 font-medium disabled:opacity-50"
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
              className="border-border bg-muted mt-1 w-full rounded border p-2"
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

function getSupervisionTab(value: string | null): SupervisionTabId {
  return supervisionTabs.find((tab) => tab.id === value)?.id ?? "overview";
}

function toDateTimeLocalValue(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function subscriptionStatusLabel(status: string | null) {
  if (status === "active") return "Activa";
  if (status === "suspended") return "Suspendida";
  return "No disponible";
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

function apoloReadinessReconciliationStatusLabel(
  status: "blocked" | "pending" | "processing" | "succeeded",
) {
  return {
    blocked: "Bloqueada; requiere intervención",
    pending: "Pendiente",
    processing: "En ejecución",
    succeeded: "Programada y saludable",
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

function whatsappTemplateProvisioningStatusLabel(
  provisioningStatus: string | undefined,
  legacyStatus: string,
) {
  const status = provisioningStatus ?? legacyStatus;
  return (
    {
      APPROVED: "Aprobada",
      DISABLED: "Deshabilitada",
      PENDING: "En revisión",
      REJECTED: "Rechazada",
      approved: "Aprobada",
      in_review: "En revisión",
      missing: "Faltante; sincronizar",
      rejected: "Rechazada",
      submitted: "Enviada a revisión",
    }[status] ?? "Estado no disponible"
  );
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

function downloadWhatsAppConfigurationExport(
  clinicId: string,
  configuration: Record<string, unknown>,
) {
  const file = new Blob([JSON.stringify(configuration, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `configuracion-whatsapp-${clinicId}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function billingHealthLabel(level: "normal" | "warning" | "critical") {
  return {
    critical: "Crítica",
    normal: "Normal",
    warning: "Advertencia",
  }[level];
}

function kapsoFundingStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "funded":
      return "Activo";
    case "pending":
      return "Pendiente";
    case "not_funded":
      return "No financiado";
    case "revoked":
      return "Revocado";
    case "unknown":
      return "No confirmado";
    default:
      return "No reportado";
  }
}

function DiagnosticValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-muted rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-foreground mt-1 font-medium break-words whitespace-normal">
        {value}
      </dd>
    </div>
  );
}

function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-muted rounded-lg border p-3">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </p>
      <p className="text-foreground mt-1 font-medium">{value}</p>
    </div>
  );
}
