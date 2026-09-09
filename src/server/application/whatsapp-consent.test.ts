import { describe, expect, it, vi } from "vitest";

import {
  buildWhatsAppConsentPolicy,
  type WhatsAppConsentEvidence,
} from "~/domain/whatsapp-consent";
import {
  canSendWhatsAppProactiveDelivery,
  createWhatsAppConsentGate,
  type WhatsAppConsentStore,
} from "./whatsapp-consent";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const POLICY = buildWhatsAppConsentPolicy("1.0");

function checkInput(overrides: Record<string, unknown> = {}) {
  return {
    clinicId: "clinic-1",
    contactId: "contact-1",
    identityId: "identity-1",
    interactiveAction: null,
    messageId: "message-1",
    now: NOW,
    phoneE164: "+50370000002",
    text: "info",
    ...overrides,
  } as Parameters<ReturnType<typeof createWhatsAppConsentGate>["check"]>[0];
}

function evidence(
  overrides: Partial<WhatsAppConsentEvidence> = {},
): WhatsAppConsentEvidence {
  return {
    acceptedAt: NOW,
    acceptedRole: "contact",
    clinicId: "clinic-1",
    contactId: "contact-1",
    id: "consent-1",
    identityId: "identity-1",
    interactionId: "message-0",
    patientId: null,
    phoneE164: "+50370000002",
    privacyVersion: POLICY.privacyVersion,
    provider: "kapso",
    scope: "channel",
    termsVersion: POLICY.termsVersion,
    textReference: POLICY.immutableTextReference,
    ...overrides,
  };
}

function fakeStore(latest: WhatsAppConsentEvidence | null = null) {
  const findLatest = vi
    .fn<WhatsAppConsentStore["findLatestWhatsAppConsent"]>()
    .mockResolvedValue(latest);
  const record = vi
    .fn<WhatsAppConsentStore["recordWhatsAppConsent"]>()
    .mockResolvedValue(evidence({ id: "consent-new" }));
  const store: WhatsAppConsentStore = {
    findLatestWhatsAppConsent: findLatest,
    readCurrentWhatsAppConsentPolicy: vi
      .fn<WhatsAppConsentStore["readCurrentWhatsAppConsentPolicy"]>()
      .mockResolvedValue(POLICY),
    recordWhatsAppConsent: record,
  };
  return { findLatest, record, store };
}

describe("gate de consentimiento inicial de WhatsApp", () => {
  it("mantiene el primer mensaje fuera del asistente y devuelve un único botón con enlaces", async () => {
    const fake = fakeStore();
    const gate = createWhatsAppConsentGate(fake.store);

    const pending = await gate.check(checkInput());
    expect(pending.kind).toBe("pending");
    if (pending.kind !== "pending" || pending.prompt === undefined)
      throw new Error("Falta el aviso de consentimiento");
    expect(pending.prompt.buttonLabel).toBe("CONTINUAR");
    expect(pending.prompt.text).toContain(POLICY.privacyUrl);

    expect(fake.record).not.toHaveBeenCalled();
    const result = await gate.check(checkInput());
    if (result.kind !== "pending")
      throw new Error("El gate no quedó pendiente");
    expect(result.prompt?.text).toContain(POLICY.termsUrl);
    expect(result.prompt?.text.match(/CONTINUAR/g)).toHaveLength(1);
  });

  it("acepta únicamente la respuesta textual exacta CONTINUAR y registra evidencia", async () => {
    const fake = fakeStore();
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(
      gate.check(checkInput({ text: "CONTINUAR", messageId: "message-2" })),
    ).resolves.toEqual({
      kind: "accepted",
      reference: "consent-new",
      consume: true,
    });

    expect(fake.record).toHaveBeenCalledWith({
      acceptedAt: NOW,
      acceptedRole: "contact",
      clinicId: "clinic-1",
      contactId: "contact-1",
      identityId: "identity-1",
      interactionId: "message-2",
      patientId: null,
      phoneE164: "+50370000002",
      policy: POLICY,
      scope: "channel",
    });
  });

  it("acepta el botón aprobado, pero no palabras parecidas ni una frase adicional", async () => {
    const fake = fakeStore();
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(
      gate.check(
        checkInput({
          interactiveAction: "continue",
          messageId: "button-1",
          text: null,
        }),
      ),
    ).resolves.toMatchObject({ kind: "accepted", consume: true });
    expect(fake.record).toHaveBeenCalledTimes(1);

    const second = fakeStore();
    const secondGate = createWhatsAppConsentGate(second.store);
    await expect(
      secondGate.check(checkInput({ text: "continuar", messageId: "text-2" })),
    ).resolves.toMatchObject({ kind: "pending" });
    await expect(
      secondGate.check(
        checkInput({ text: "CONTINUAR por favor", messageId: "text-3" }),
      ),
    ).resolves.toMatchObject({ kind: "pending" });
    expect(second.record).not.toHaveBeenCalled();
  });

  it("reabre el gate si la evidencia más reciente pertenece a una versión anterior", async () => {
    const fake = fakeStore(
      evidence({ termsVersion: "0.9", textReference: "old-reference" }),
    );
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(gate.check(checkInput())).resolves.toMatchObject({
      kind: "pending",
    });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("no habilita el asistente antes de que la evidencia entre en vigor", async () => {
    const fake = fakeStore(
      evidence({
        acceptedAt: new Date(NOW.valueOf() + 1),
      }),
    );
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(
      gate.check(checkInput({ text: "info" })),
    ).resolves.toMatchObject({
      kind: "pending",
    });
  });

  it("reutiliza la referencia vigente para un mensaje normal y no crea evidencia adicional", async () => {
    const current = evidence();
    const fake = fakeStore(current);
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(gate.check(checkInput({ text: "info" }))).resolves.toEqual({
      kind: "accepted",
      consume: false,
      reference: current.id,
    });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("solo permite una Entrega proactiva con evidencia vigente y ya aceptada", async () => {
    const current = evidence();
    const fake = fakeStore(current);
    await expect(
      canSendWhatsAppProactiveDelivery(
        { clinicId: "clinic-1", contactId: "contact-1", now: NOW },
        fake.store,
      ),
    ).resolves.toBe(true);

    const stale = fakeStore(
      evidence({ termsVersion: "0.9", textReference: "old-reference" }),
    );
    await expect(
      canSendWhatsAppProactiveDelivery(
        { clinicId: "clinic-1", contactId: "contact-1", now: NOW },
        stale.store,
      ),
    ).resolves.toBe(false);
    await expect(
      canSendWhatsAppProactiveDelivery(
        {
          clinicId: "clinic-1",
          contactId: "contact-1",
          now: new Date(NOW.valueOf() - 1),
        },
        fake.store,
      ),
    ).resolves.toBe(false);
  });

  it("conserva una sola evidencia cuando el mismo botón se reintenta", async () => {
    const recorded = evidence({ id: "consent-repeat" });
    const fake = fakeStore();
    fake.record.mockResolvedValue(recorded);
    fake.findLatest.mockResolvedValueOnce(null).mockResolvedValueOnce(recorded);
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(
      gate.check(checkInput({ messageId: "button-repeat", text: "CONTINUAR" })),
    ).resolves.toMatchObject({
      consume: true,
      reference: "consent-repeat",
    });
    await expect(
      gate.check(checkInput({ messageId: "button-repeat", text: "CONTINUAR" })),
    ).resolves.toMatchObject({
      consume: true,
      reference: "consent-repeat",
    });
    expect(fake.record).toHaveBeenCalledTimes(1);
  });
});
