import { describe, expect, it } from "vitest";

import {
  hasWhatsAppIdentityChanged,
  resolveWhatsAppIdentity,
  type WhatsAppIdentityRecord,
} from "./whatsapp-identity";

const identity = (
  overrides: Partial<WhatsAppIdentityRecord> = {},
): WhatsAppIdentityRecord => ({
  businessScopedUserId: "US.USER.1",
  contactId: "contact-1",
  id: "identity-1",
  parentBusinessScopedUserId: null,
  phoneE164: "+50370001111",
  phoneNumberId: "phone-1",
  status: "active",
  username: "@ana",
  waId: "50370001111",
  ...overrides,
});

describe("Identidad de WhatsApp", () => {
  it("busca por BSUID antes que por teléfono", () => {
    expect(
      resolveWhatsAppIdentity({
        businessScopedUserId: "US.USER.1",
        identities: [identity()],
        phoneE164: "+50370001111",
        phoneNumberId: "phone-1",
      }),
    ).toMatchObject({
      identity: { contactId: "contact-1", id: "identity-1" },
      matchedBy: "business-scoped-user-id",
    });
  });

  it("usa el teléfono cuando el mensaje no trae BSUID", () => {
    expect(
      resolveWhatsAppIdentity({
        businessScopedUserId: null,
        identities: [identity()],
        phoneE164: "+50370001111",
        phoneNumberId: "phone-1",
      }),
    ).toMatchObject({
      identity: { contactId: "contact-1" },
      matchedBy: "phone",
    });
  });

  it("rechaza una combinación que apunta a Contactos distintos", () => {
    expect(
      resolveWhatsAppIdentity({
        businessScopedUserId: "US.USER.1",
        identities: [
          identity(),
          identity({
            businessScopedUserId: null,
            contactId: "contact-2",
            id: "identity-2",
          }),
        ],
        phoneE164: "+50370001111",
        phoneNumberId: "phone-1",
      }),
    ).toEqual({
      kind: "conflict",
      reason: "La Identidad de WhatsApp coincide con dos Contactos",
    });
  });

  it("detecta un cambio sin borrar el snapshot anterior", () => {
    expect(
      hasWhatsAppIdentityChanged(
        identity(),
        identity({ phoneE164: null, waId: null }),
      ),
    ).toBe(true);
    expect(hasWhatsAppIdentityChanged(identity(), identity())).toBe(false);
  });
});
