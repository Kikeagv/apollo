import { describe, expect, it, vi } from "vitest";

import {
  runWhatsAppApprovedTemplateSmoke,
  type PreparedWhatsAppTemplateSmoke,
  type WhatsAppTemplateSmokeStore,
} from "./whatsapp-template-smoke";
import type { WhatsAppTemplateSmokeSender } from "./whatsapp-template-smoke";

const prepared: PreparedWhatsAppTemplateSmoke = {
  attemptId: "f5d2cc37-646e-4298-a751-b348c4dc0333",
  clinicName: "Clínica Apolo",
  contactId: "controlled-contact-1",
  consent: {
    acceptedAt: new Date("2026-09-30T11:00:00.000Z"),
    privacyVersion: "1.0",
    reference: "consent-1",
    termsVersion: "1.0",
    textReference: "wa-consent-v1",
  },
  phoneE164: "+50370000001",
  runId: "3a1917e2-bd36-4b45-9b61-e3810fd28051",
  startedAt: new Date("2026-09-30T12:00:00.000Z"),
  template: {
    catalogVersion: 3,
    category: "UTILITY",
    kind: "confirmation",
    locale: "es",
    name: "appointment_confirmation",
    providerTemplateId: "template-1",
    status: "APPROVED",
    variables: ["clinicName", "patientName", "startsAt"],
  },
};

function storeFixture() {
  return {
    start: vi
      .fn<WhatsAppTemplateSmokeStore["start"]>()
      .mockResolvedValue(prepared),
    accepted: vi
      .fn<WhatsAppTemplateSmokeStore["accepted"]>()
      .mockResolvedValue(undefined),
    fail: vi
      .fn<WhatsAppTemplateSmokeStore["fail"]>()
      .mockResolvedValue(undefined),
  };
}

describe("prueba de plantilla Utility aprobada", () => {
  it("deja el paso pendiente ante aceptación de API y usa idempotencia por intento", async () => {
    const store = storeFixture();
    const sendSmokeTemplate = vi
      .fn<WhatsAppTemplateSmokeSender["sendSmokeTemplate"]>()
      .mockResolvedValue({
        providerMessageId: "wamid-accepted",
        status: "accepted",
      });

    const result = await runWhatsAppApprovedTemplateSmoke(
      {
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
        now: prepared.startedAt,
        templateKind: "confirmation",
      },
      { sender: { sendSmokeTemplate }, store },
    );

    expect(sendSmokeTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        idempotencyKey: `whatsapp-smoke:${prepared.runId}:template:${prepared.attemptId}`,
        recipientPhoneE164: prepared.phoneE164,
      }),
    );
    expect(sendSmokeTemplate.mock.calls[0]?.[0]?.route.kind).toBe("template");
    expect(result).toMatchObject({
      providerMessageId: "wamid-accepted",
      runId: prepared.runId,
      status: "pending",
    });
    expect(store.fail.mock.calls).toHaveLength(0);
  });

  it("deja pendiente una respuesta ambigua para esperar callback o timeout", async () => {
    const store = storeFixture();
    const sendSmokeTemplate = vi
      .fn<WhatsAppTemplateSmokeSender["sendSmokeTemplate"]>()
      .mockRejectedValue(
        Object.assign(new Error("sin respuesta"), { ambiguous: true }),
      );

    const result = await runWhatsAppApprovedTemplateSmoke(
      {
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
        now: prepared.startedAt,
        templateKind: "confirmation",
      },
      { sender: { sendSmokeTemplate }, store },
    );

    expect(result.status).toBe("pending");
    expect(store.fail.mock.calls).toHaveLength(0);
  });

  it("persiste fallo y sanitiza errores antes de devolverlos al panel", async () => {
    const store = storeFixture();
    const sendSmokeTemplate = vi
      .fn<WhatsAppTemplateSmokeSender["sendSmokeTemplate"]>()
      .mockRejectedValue(
        new Error("X-API-Key: supersecret Kapso rechazó la plantilla"),
      );

    const result = await runWhatsAppApprovedTemplateSmoke(
      {
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
        now: prepared.startedAt,
        templateKind: "confirmation",
      },
      { sender: { sendSmokeTemplate }, store },
    );

    expect(result.status).toBe("failed");
    expect(result.message).not.toContain("supersecret");
    expect(store.fail.mock.calls).toHaveLength(1);
    expect(store.fail.mock.calls[0]?.[0]).toMatchObject({
      attemptId: prepared.attemptId,
    });
  });
});
