import {
  buildTransactionalTemplateParameters,
  chooseTransactionalWhatsAppRoute,
} from "~/domain/whatsapp-delivery";
import { WHATSAPP_TEMPLATE_SMOKE_TIMEOUT_MS } from "~/domain/whatsapp-smoke";
import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import type { WhatsAppCriticalTemplateKind } from "~/domain/whatsapp-readiness";
import type { TransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";
import type { WhatsAppSendResult } from "./whatsapp-provider";

export type PreparedWhatsAppTemplateSmoke = {
  clinicName: string;
  attemptId: string;
  contactId: string;
  phoneE164: string;
  runId: string;
  templateAttemptStartedAt: Date;
  consent: {
    acceptedAt: Date;
    privacyVersion: string;
    reference: string;
    termsVersion: string;
    textReference: string;
  };
  template: {
    catalogVersion: number;
    category: string | null;
    kind: WhatsAppCriticalTemplateKind;
    locale: string;
    name: string;
    providerTemplateId: string | null;
    status: string;
    variables: string[];
  };
};

export type WhatsAppTemplateSmokeStore = {
  start(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
    templateKind: WhatsAppCriticalTemplateKind;
    timeoutAt: Date;
  }): Promise<PreparedWhatsAppTemplateSmoke>;
  accepted(input: {
    clinicId: string;
    attemptId: string;
    providerMessageId: string;
    runId: string;
  }): Promise<void>;
  fail(input: {
    clinicId: string;
    error: string;
    now: Date;
    attemptId: string;
    runId: string;
  }): Promise<void>;
};

export type WhatsAppTemplateSmokeSender = {
  sendSmokeTemplate(input: {
    clinicId: string;
    contactId: string;
    consentEvidence: PreparedWhatsAppTemplateSmoke["consent"];
    idempotencyKey: string;
    recipientPhoneE164: string;
    route: Extract<TransactionalWhatsAppRoute, { kind: "template" }>;
  }): Promise<WhatsAppSendResult>;
};

export async function runWhatsAppApprovedTemplateSmoke(
  input: {
    actorIdentityId: string;
    clinicId: string;
    now?: Date;
    templateKind: WhatsAppCriticalTemplateKind;
  },
  dependencies: {
    sender: WhatsAppTemplateSmokeSender;
    store: WhatsAppTemplateSmokeStore;
  },
) {
  const now = input.now ?? new Date();
  const prepared = await dependencies.store.start({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    now,
    templateKind: input.templateKind,
    timeoutAt: new Date(now.valueOf() + WHATSAPP_TEMPLATE_SMOKE_TIMEOUT_MS),
  });
  const idempotencyKey = `whatsapp-smoke:${prepared.runId}:template:${prepared.attemptId}`;

  let result: WhatsAppSendResult;
  try {
    const route = chooseTransactionalWhatsAppRoute({
      template: {
        category: prepared.template.category,
        locale: prepared.template.locale,
        name: prepared.template.name,
        parameters: buildTransactionalTemplateParameters(
          prepared.template.variables,
          {
            clinicName: prepared.clinicName,
            doctorName: "Equipo de la Clínica",
            patientName: "Contacto de prueba",
            startsAt: new Date(
              prepared.templateAttemptStartedAt.valueOf() + 24 * 60 * 60_000,
            ),
          },
        ),
        providerTemplateId: prepared.template.providerTemplateId,
        status: prepared.template.status,
      },
      text: `Mensaje de prueba de la Clínica ${prepared.clinicName}.`,
    });
    if (route.kind !== "template") {
      throw new Error("No se preparó una plantilla Utility para la prueba");
    }
    result = await dependencies.sender.sendSmokeTemplate({
      clinicId: input.clinicId,
      contactId: prepared.contactId,
      consentEvidence: prepared.consent,
      idempotencyKey,
      recipientPhoneE164: prepared.phoneE164,
      route,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    if (isAmbiguousSend(error)) {
      return {
        message:
          "No se pudo confirmar la respuesta de Kapso; el paso queda pendiente del callback o del timeout.",
        providerMessageId: null,
        runId: prepared.runId,
        status: "pending" as const,
      };
    }
    await dependencies.store.fail({
      clinicId: input.clinicId,
      error: message,
      now,
      attemptId: prepared.attemptId,
      runId: prepared.runId,
    });
    return {
      message,
      providerMessageId: null,
      runId: prepared.runId,
      status: "failed" as const,
    };
  }

  await dependencies.store.accepted({
    clinicId: input.clinicId,
    attemptId: prepared.attemptId,
    providerMessageId: result.providerMessageId,
    runId: prepared.runId,
  });
  return {
    message:
      "Kapso aceptó la solicitud; el paso seguirá pendiente hasta recibir el callback de entrega.",
    providerMessageId: result.providerMessageId,
    runId: prepared.runId,
    status: "pending" as const,
  };
}

function isAmbiguousSend(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "ambiguous" in error &&
    error.ambiguous === true
  );
}

function toErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "No se pudo enviar la plantilla de prueba";
  return (
    sanitizeWhatsAppOperationalText(message) ||
    "No se pudo enviar la plantilla de prueba"
  );
}
