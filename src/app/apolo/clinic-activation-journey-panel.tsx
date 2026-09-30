"use client";

import type {
  ClinicActivationSmokeRun,
  ClinicActivationStepId,
} from "~/domain/clinic-activation-journey";
import { buildClinicActivationJourney } from "~/domain/clinic-activation-journey";
import { formatDateTime } from "~/app/format-date";
import {
  whatsappSyntheticSmokeStepLabels,
  type WhatsAppSyntheticSmokeStep,
} from "~/domain/whatsapp-smoke";
import type { ClinicRegistration } from "~/server/application/clinic-registration";
import type { KapsoWhatsAppOnboardingSnapshot } from "~/server/application/kapso-onboarding";
import type { WhatsAppNumberHealth } from "~/domain/whatsapp-readiness";

const stepLabels: Record<ClinicActivationStepId, string> = {
  "clinic-registration": "Registrar la Clínica y asociar a su propietario",
  "setup-link": "Enviar el Enlace de configuración al propietario",
  "inbound-roundtrip": "Probar recepción y respuesta de la Clínica",
  "template-delivery": "Probar una conversación iniciada con plantilla",
};

const stepStatusLabels = {
  completed: "Completo",
  failed: "Falló",
  pending: "Pendiente",
} as const;

const stepStatusClasses = {
  completed: "border-primary/25 bg-primary/5 text-primary",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  pending: "border-border bg-muted text-muted-foreground",
} as const;

const smokeStepStatusLabels: Record<
  WhatsAppSyntheticSmokeStep["status"],
  string
> = {
  failed: "Falló",
  passed: "Verificado",
  pending: "Pendiente",
  skipped: "No ejecutado",
};

export function ClinicActivationJourneyPanel({
  instanceId,
  clinicId,
  isLoading,
  isSending,
  latestSmoke,
  currentProvisioningEventId,
  numberHealth,
  numberHealthCheckedAt,
  onContinueWhatsApp,
  onRegister,
  onSendSetupLink,
  registration,
  sendError,
  sendMessage,
  sendStatus,
  onboarding,
}: {
  instanceId: string;
  clinicId: string;
  isLoading: boolean;
  isSending: boolean;
  latestSmoke: ClinicActivationSmokeRun | null;
  currentProvisioningEventId: string | null;
  numberHealth: WhatsAppNumberHealth;
  numberHealthCheckedAt: Date | null;
  onContinueWhatsApp: () => void;
  onRegister: () => void;
  onSendSetupLink: () => void;
  registration: ClinicRegistration | null;
  sendError: string | null;
  sendMessage: string | null;
  sendStatus: "failed" | "sent" | null;
  onboarding: KapsoWhatsAppOnboardingSnapshot | null;
}) {
  const ownerAssociated = Boolean(
    registration?.invitation.email && registration.invitation.recipientName,
  );
  const currentSetupLinkId = onboarding?.setupLinkProviderId ?? null;
  const latestDelivery = onboarding?.setupLinkHistory.find(
    (event) =>
      event.setupLinkId === currentSetupLinkId &&
      (event.action === "setup-link-email-sent" ||
        event.action === "setup-link-email-failed"),
  );
  const journey = buildClinicActivationJourney({
    clinicRegistered: registration !== null,
    ownerAssociated,
    providerHealth: numberHealth,
    providerHealthCheckedAt: numberHealthCheckedAt,
    setupLinkCreatedAt: onboarding?.setupLink?.createdAt ?? null,
    setupLinkDelivery:
      latestDelivery === undefined
        ? null
        : {
            occurredAt: latestDelivery.occurredAt,
            result:
              latestDelivery.action === "setup-link-email-sent"
                ? "succeeded"
                : "failed",
            setupLinkId: currentSetupLinkId ?? "",
          },
    setupLinkId: currentSetupLinkId,
    setupLinkStatus: onboarding?.setupLink?.status ?? null,
    latestSmoke,
    currentProvisioningEventId,
  });
  const preflightPassed = onboarding?.preflight?.status === "passed";
  const setupLinkCanBeSent =
    clinicId !== "" &&
    preflightPassed &&
    onboarding?.setupLink?.status !== "used";
  const registrationStep = journey.steps[0]!;
  const setupLinkStep = journey.steps[1]!;
  const templateDeliveryStep = journey.steps.find(
    (step) => step.id === "template-delivery",
  )!;
  const titleId = `clinic-activation-journey-${instanceId}-title`;
  const healthId = `activation-provider-health-${instanceId}-title`;
  const evidenceId = `activation-transport-evidence-${instanceId}-title`;

  return (
    <section
      aria-labelledby={titleId}
      className="border-border bg-card space-y-5 rounded-xl border p-5 shadow-sm"
      data-clinic-activation-journey="true"
    >
      <header className="space-y-1">
        <p className="text-primary text-xs font-semibold tracking-wide uppercase">
          Activación de WhatsApp
        </p>
        <h2 className="text-xl font-semibold" id={titleId}>
          Recorrido de cuatro pasos
        </h2>
        <p className="text-muted-foreground text-sm">
          Progreso del enrolamiento, salud operativa y pruebas de transporte se
          muestran por separado.
        </p>
      </header>

      <div className="border-border bg-muted flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
        <span className="font-medium">Enrolamiento:</span>
        <span role="status">
          {enrollmentProgressLabel(journey.enrollmentProgress)}
        </span>
        {registration?.clinic.name ? (
          <span className="text-muted-foreground">
            · {registration.clinic.name}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          Cargando el estado del recorrido…
        </p>
      ) : null}

      <ol className="grid gap-3 lg:grid-cols-2">
        {journey.steps.map((step, index) => (
          <li
            className="border-border bg-background min-w-0 space-y-2 rounded-lg border p-4"
            key={step.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">
                <span className="text-muted-foreground mr-2">{index + 1}.</span>
                {stepLabels[step.id]}
              </h3>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${stepStatusClasses[step.status]}`}
              >
                {stepStatusLabels[step.status]}
              </span>
            </div>

            {step.id === "clinic-registration" ? (
              <p className="text-muted-foreground text-sm">
                {registration && ownerAssociated
                  ? `Propietario: ${registration.invitation.recipientName} · ${registration.invitation.email}`
                  : "Registra los datos de la Clínica y del Médico propietario."}
              </p>
            ) : null}

            {step.id === "setup-link" ? (
              <>
                <p className="text-muted-foreground text-sm">
                  {onboarding?.setupLink?.status === "used"
                    ? "El propietario completó el enlace de configuración. Las pruebas de transporte siguen pendientes."
                    : latestDelivery?.action === "setup-link-email-sent"
                      ? `Enlace enviado a ${registration?.invitation.email ?? "el propietario"} · ${formatDateTime(latestDelivery.occurredAt)}`
                      : latestDelivery?.action === "setup-link-email-failed"
                        ? "El enlace está activo, pero el correo no se entregó. Puedes reintentar el envío."
                        : preflightPassed
                          ? "La verificación previa está completa. Envía el enlace al correo registrado del propietario."
                          : "Completa la verificación previa de WhatsApp para enviar el enlace de forma segura."}
                </p>
                {onboarding?.setupLink?.status ===
                "used" ? null : setupLinkStep.status === "completed" &&
                  onboarding?.setupLink?.status === "active" ? (
                  <button
                    className="border-border hover:bg-muted min-h-10 rounded-lg border px-3 py-2 text-sm font-medium"
                    disabled={isSending}
                    onClick={onSendSetupLink}
                    type="button"
                  >
                    {isSending ? "Enviando…" : "Reenviar al propietario"}
                  </button>
                ) : setupLinkCanBeSent ? (
                  <button
                    className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-10 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                    disabled={isSending}
                    onClick={onSendSetupLink}
                    type="button"
                  >
                    {isSending
                      ? "Enviando…"
                      : setupLinkStep.status === "failed"
                        ? "Reintentar envío"
                        : "Enviar enlace al propietario"}
                  </button>
                ) : clinicId ? (
                  <button
                    className="border-border hover:bg-muted min-h-10 rounded-lg border px-3 py-2 text-sm font-medium"
                    onClick={onContinueWhatsApp}
                    type="button"
                  >
                    Completar verificación previa
                  </button>
                ) : null}
              </>
            ) : null}

            {step.id === "inbound-roundtrip" ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  {roundtripSummary(journey.inboundRoundtrip.status)}
                </p>
                {journey.inboundRoundtrip.runId ? (
                  <>
                    <p className="text-muted-foreground text-xs">
                      Ejecución {journey.inboundRoundtrip.runId} · Contacto
                      controlado:{" "}
                      {journey.inboundRoundtrip.contactMaskedPhone ??
                        "teléfono no disponible"}
                    </p>
                    <ol
                      aria-label="Evidencia del roundtrip entrante"
                      className="space-y-1 text-xs"
                    >
                      {journey.inboundRoundtrip.steps.map((evidence) => (
                        <li key={evidence.code}>
                          <span className="font-medium">
                            {whatsappSyntheticSmokeStepLabels[evidence.code]}:
                          </span>{" "}
                          <span>{smokeStepStatusLabels[evidence.status]}</span>
                          {evidence.evidence ? ` · ${evidence.evidence}` : ""}
                          {evidence.source
                            ? ` · ${evidence.source === "provider" ? "Kapso" : "Praxia"}`
                            : ""}
                          {evidence.eventId ? ` · ${evidence.eventId}` : ""}
                          {evidence.observedAt
                            ? ` · ${formatDateTime(evidence.observedAt)}`
                            : ""}
                          {evidence.message ? ` · ${evidence.message}` : ""}
                        </li>
                      ))}
                    </ol>
                    <p className="text-muted-foreground text-xs">
                      Preflight del webhook:{" "}
                      {preflightSummary(journey.inboundRoundtrip.preflight)}. No
                      cuenta como roundtrip ni habilita tráfico real.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Aún no hay una ejecución real con un Contacto controlado. Un
                    preflight no cuenta como roundtrip.
                  </p>
                )}
              </div>
            ) : null}

            {step.id === "template-delivery" ? (
              <p className="text-muted-foreground text-sm">
                Pendiente de una conversación iniciada con plantilla aprobada y
                evidencia de entrega.
              </p>
            ) : null}

            {step.updatedAt ? (
              <p className="text-muted-foreground text-xs">
                Última actualización de evidencia:{" "}
                {formatDateTime(step.updatedAt)}
              </p>
            ) : step.id === "inbound-roundtrip" ||
              step.id === "template-delivery" ? (
              <p className="text-muted-foreground text-xs">
                Evidencia aún no registrada.
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {!clinicId || registrationStep.status !== "completed" ? (
        <button
          className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-10 rounded-lg px-4 py-2 text-sm font-medium"
          onClick={onRegister}
          type="button"
        >
          Registrar una Clínica
        </button>
      ) : null}

      <div className="border-border grid gap-4 border-t pt-4 sm:grid-cols-2">
        <section aria-labelledby={healthId} className="space-y-1">
          <h3 className="text-sm font-semibold" id={healthId}>
            Salud operativa del proveedor
          </h3>
          <p className="text-sm" role="status">
            {providerHealthLabel(journey.providerHealth.status)}
          </p>
          <p className="text-muted-foreground text-xs">
            {journey.providerHealth.checkedAt
              ? `Última verificación: ${formatDateTime(journey.providerHealth.checkedAt)}`
              : "Sin verificación registrada."}
          </p>
          {journey.providerHealth.status === "unverified" ? (
            <p className="text-muted-foreground text-xs">
              Una consulta sin confirmar no demuestra que el proveedor esté
              caído.
            </p>
          ) : null}
          {onboarding?.connection?.provider === "simulated" ? (
            <p className="text-primary text-xs" role="note">
              Proveedor simulado: esta comprobación es evidencia de Praxia, no
              de Kapso real.
            </p>
          ) : null}
        </section>

        <section aria-labelledby={evidenceId} className="space-y-1">
          <h3 className="text-sm font-semibold" id={evidenceId}>
            Evidencia de transporte
          </h3>
          <p className="text-muted-foreground text-sm">
            Roundtrip entrante:{" "}
            {stepStatusLabels[journey.inboundRoundtrip.status]}
          </p>
          <p className="text-muted-foreground text-sm">
            Preflight del webhook:{" "}
            {preflightSummary(journey.inboundRoundtrip.preflight)} · no
            demuestra una conversación.
          </p>
          <p className="text-muted-foreground text-sm">
            Inicio con plantilla y entrega:{" "}
            {stepStatusLabels[templateDeliveryStep.status]}.
          </p>
          <p className="text-muted-foreground text-xs">
            La Clínica no se marca lista para tráfico real hasta completar la
            prueba de plantilla.
          </p>
        </section>
      </div>

      {sendMessage ? (
        <p
          className={`rounded-lg border p-3 text-sm ${sendStatus === "failed" ? "border-warning-border bg-warning-muted text-warning-foreground" : "border-border bg-muted text-primary"}`}
          role={sendStatus === "failed" ? "alert" : "status"}
        >
          {sendMessage}
        </p>
      ) : null}
      {sendError ? (
        <p className="text-warning-foreground text-sm" role="alert">
          {sendError}
        </p>
      ) : null}
    </section>
  );
}

function enrollmentProgressLabel(
  status: "completed" | "in-progress" | "pending",
) {
  const labels = {
    completed: "Completado",
    "in-progress": "En curso",
    pending: "Pendiente",
  };
  return labels[status];
}

function providerHealthLabel(status: "healthy" | "issue" | "unverified") {
  const labels = {
    healthy: "Confirmada como saludable",
    issue: "Estado confirmado que requiere atención",
    unverified: "Verificación pendiente",
  };
  return labels[status];
}

function roundtripSummary(status: "completed" | "failed" | "pending") {
  const labels = {
    completed: "Roundtrip entregado al Contacto controlado.",
    failed: "La prueba del roundtrip falló; revisa la evidencia de cada paso.",
    pending: "Pendiente de la prueba real con un Contacto controlado.",
  };
  return labels[status];
}

function preflightSummary(step: WhatsAppSyntheticSmokeStep | null) {
  if (step === null) return "no ejecutado";
  return smokeStepStatusLabels[step.status].toLocaleLowerCase("es");
}
