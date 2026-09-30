import { describe, expect, it, vi } from "vitest";

import {
  buildWhatsAppConsentPolicy,
  type WhatsAppConsentEvidence,
} from "~/domain/whatsapp-consent";
import {
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
    actorIdentityId: null,
    clinicId: "clinic-1",
    contactId: "contact-1",
    declaration: "CONTINUAR",
    id: "consent-1",
    identityId: "identity-1",
    interactionId: "message-0",
    origin: "whatsapp_inbound",
    patientId: null,
    phoneE164: "+50370000002",
    privacyVersion: POLICY.privacyVersion,
    provider: "kapso",
    sourcePatientId: null,
    scope: "contact",
    status: "accepted",
    termsVersion: POLICY.termsVersion,
    textReference: POLICY.immutableTextReference,
    ...overrides,
  };
}

function fakeStore(initial: WhatsAppConsentEvidence | null = null) {
  let latest = initial;
  let nextId = 1;
  const findLatest = vi
    .fn<WhatsAppConsentStore["findLatestWhatsAppConsent"]>()
    .mockImplementation(async () => latest);
  const record = vi
    .fn<WhatsAppConsentStore["recordWhatsAppConsent"]>()
    .mockImplementation(async (input) => {
      const existing = latest;
      if (existing?.interactionId === input.interactionId) return existing;
      latest = evidence({
        acceptedAt: input.acceptedAt,
        declaration: input.declaration,
        id: `consent-${nextId++}`,
        identityId: input.identityId,
        interactionId: input.interactionId,
        phoneE164: input.phoneE164,
        privacyVersion: input.policy.privacyVersion,
        status: input.status ?? "accepted",
        termsVersion: input.policy.termsVersion,
        textReference: input.policy.immutableTextReference,
      });
      return latest;
    });
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
  it("presenta términos y el alcance administrativo para todos los Pacientes del Contacto", async () => {
    const fake = fakeStore();
    const gate = createWhatsAppConsentGate(fake.store);

    const pending = await gate.check(checkInput());
    expect(pending.kind).toBe("pending");
    if (pending.kind !== "pending" || pending.prompt === undefined)
      throw new Error("Falta el aviso de consentimiento");
    expect(pending.prompt.buttonLabel).toBe("CONTINUAR");
    expect(pending.prompt.text).toContain(POLICY.privacyUrl);
    expect(pending.prompt.text).toContain(POLICY.termsUrl);
    expect(pending.prompt.text).toContain("actuales y futuros");
    expect(pending.prompt.text).toContain("confirmaciones, recordatorios");
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("registra CONTINUAR una sola vez a nivel del Contacto", async () => {
    const fake = fakeStore();
    const gate = createWhatsAppConsentGate(fake.store);
    const input = checkInput({ messageId: "continue-1", text: "CONTINUAR" });

    await expect(gate.check(input)).resolves.toEqual({
      kind: "accepted",
      reference: "consent-1",
      consume: true,
    });
    await expect(gate.check(input)).resolves.toEqual({
      kind: "accepted",
      reference: "consent-1",
      consume: true,
    });
    expect(fake.record).toHaveBeenCalledTimes(1);
    expect(fake.record).toHaveBeenCalledWith({
      acceptedAt: NOW,
      clinicId: "clinic-1",
      contactId: "contact-1",
      declaration: "CONTINUAR",
      identityId: "identity-1",
      interactionId: "continue-1",
      phoneE164: "+50370000002",
      policy: POLICY,
      status: "accepted",
    });
  });

  it("acepta el botón, pero no palabras parecidas ni una frase adicional", async () => {
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

  it("mantiene vigente la aceptación si cambia la versión de términos", async () => {
    const fake = fakeStore(
      evidence({ termsVersion: "0.9", textReference: "old-reference" }),
    );
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(gate.check(checkInput({ text: "info" }))).resolves.toEqual({
      kind: "accepted",
      consume: false,
      reference: "consent-1",
    });
    expect(fake.record).not.toHaveBeenCalled();
  });

  it("no acepta evidencia futura ni vuelve a pedir consentimiento para mensajes normales", async () => {
    const future = fakeStore(
      evidence({ acceptedAt: new Date(NOW.valueOf() + 1) }),
    );
    await expect(
      createWhatsAppConsentGate(future.store).check(checkInput()),
    ).resolves.toMatchObject({ kind: "pending" });

    const current = evidence();
    const existing = fakeStore(current);
    await expect(
      createWhatsAppConsentGate(existing.store).check(checkInput()),
    ).resolves.toEqual({
      kind: "accepted",
      consume: false,
      reference: current.id,
    });
    expect(existing.record).not.toHaveBeenCalled();
  });

  it("registra opt-out como revocación y exige un nuevo CONTINUAR para reactivar", async () => {
    const fake = fakeStore(evidence());
    const gate = createWhatsAppConsentGate(fake.store);

    await expect(
      gate.check(
        checkInput({ messageId: "opt-out-1", text: "No me escriban más" }),
      ),
    ).resolves.toEqual({ kind: "revoked", reference: "consent-1" });
    expect(fake.record).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionId: "opt-out-1",
        status: "revoked",
      }),
    );
    await expect(
      gate.check(checkInput({ messageId: "after-opt-out", text: "info" })),
    ).resolves.toMatchObject({ kind: "pending" });
    await expect(
      gate.check(checkInput({ messageId: "opt-in-2", text: "CONTINUAR" })),
    ).resolves.toMatchObject({ kind: "accepted", consume: true });
  });
});
