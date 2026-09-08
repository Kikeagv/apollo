export type WhatsAppIdentityStatus =
  "active" | "conflict" | "historical" | "unresolved";

export type WhatsAppIdentityRecord = {
  businessScopedUserId: string | null;
  contactId: string | null;
  id: string;
  parentBusinessScopedUserId: string | null;
  phoneE164: string | null;
  phoneNumberId: string;
  status: WhatsAppIdentityStatus;
  username: string | null;
  waId: string | null;
};

export type WhatsAppIdentityResolution =
  | {
      identity: WhatsAppIdentityRecord & { contactId: string };
      kind: "matched";
      matchedBy: "business-scoped-user-id" | "phone";
    }
  | { kind: "conflict"; reason: string }
  | { kind: "unresolved"; reason: string };

const IDENTITY_CONFLICT_REASON =
  "La Identidad de WhatsApp coincide con dos Contactos";

/**
 * Resuelve la identidad dentro de una sola clínica y un phone_number_id.
 *
 * BSUID tiene precedencia porque puede existir aunque WhatsApp no exponga un
 * teléfono. Si los dos identificadores apuntan a Contactos distintos no se
 * elige silenciosamente: el caso queda para resolución humana.
 */
export function resolveWhatsAppIdentity(input: {
  businessScopedUserId: string | null;
  identities: WhatsAppIdentityRecord[];
  phoneE164: string | null;
  phoneNumberId: string;
}): WhatsAppIdentityResolution {
  const activeIdentities = input.identities.filter(
    (identity) =>
      identity.status === "active" &&
      identity.phoneNumberId === input.phoneNumberId,
  );
  const byBusinessScopedUserId =
    input.businessScopedUserId === null
      ? []
      : activeIdentities.filter(
          (identity) =>
            identity.businessScopedUserId === input.businessScopedUserId,
        );
  const byPhone =
    input.phoneE164 === null
      ? []
      : activeIdentities.filter(
          (identity) => identity.phoneE164 === input.phoneE164,
        );

  const candidates = uniqueIdentities([...byBusinessScopedUserId, ...byPhone]);
  if (candidates.length === 0) {
    return {
      kind: "unresolved",
      reason: "No existe una Identidad de WhatsApp activa para el Contacto",
    };
  }

  const contactIds = new Set(candidates.map((identity) => identity.contactId));
  if (contactIds.size > 1 || contactIds.has(null)) {
    return { kind: "conflict", reason: IDENTITY_CONFLICT_REASON };
  }

  const identity = byBusinessScopedUserId[0] ?? byPhone[0];
  if (identity?.contactId == null) {
    return {
      kind: "unresolved",
      reason:
        "La Identidad de WhatsApp todavía no está vinculada a un Contacto",
    };
  }
  const contactId = identity.contactId;

  return {
    identity: { ...identity, contactId },
    kind: "matched",
    matchedBy:
      byBusinessScopedUserId.length > 0 ? "business-scoped-user-id" : "phone",
  };
}

export function hasWhatsAppIdentityChanged(
  previous: WhatsAppIdentityRecord,
  next: WhatsAppIdentityRecord,
) {
  return (
    previous.businessScopedUserId !== next.businessScopedUserId ||
    previous.contactId !== next.contactId ||
    previous.parentBusinessScopedUserId !== next.parentBusinessScopedUserId ||
    previous.phoneE164 !== next.phoneE164 ||
    previous.phoneNumberId !== next.phoneNumberId ||
    previous.username !== next.username ||
    previous.waId !== next.waId
  );
}

function uniqueIdentities(identities: WhatsAppIdentityRecord[]) {
  const byId = new Map<string, WhatsAppIdentityRecord>();
  for (const identity of identities) byId.set(identity.id, identity);
  return [...byId.values()];
}
