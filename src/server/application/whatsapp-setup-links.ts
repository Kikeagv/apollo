import {
  isWhatsAppSetupLinkUsable,
  whatsappSetupLinkStatus,
} from "~/domain/whatsapp-setup-link";
import {
  KapsoProviderError,
  KapsoProviderUnavailableError,
  type KapsoOnboardingProvider,
  type KapsoSetupLink,
} from "~/server/whatsapp/kapso-onboarding";

import {
  type KapsoWhatsAppOnboardingSnapshot,
  type KapsoWhatsAppOnboardingStore,
} from "./kapso-onboarding";

export type ManageKapsoWhatsAppSetupLinkInput = {
  action: "generate" | "regenerate" | "revoke";
  actorIdentityId: string;
  actorType: "clinic-owner" | "superadmin";
  clinicId: string;
  reason?: string;
};

type ManageKapsoWhatsAppSetupLinkDependencies = {
  appUrl: string;
  now?: () => Date;
  provider: KapsoOnboardingProvider;
  store: KapsoWhatsAppOnboardingStore;
};

const defaultReason = {
  generate: "Enlace de configuración generado desde una sesión autenticada.",
  regenerate:
    "Enlace de configuración regenerado desde una sesión autenticada.",
  revoke: "Enlace de configuración revocado desde una sesión autenticada.",
} as const;

export async function manageKapsoWhatsAppSetupLink(
  input: ManageKapsoWhatsAppSetupLinkInput,
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
) {
  assertActionAllowed(input);
  const now = dependencies.now ?? (() => new Date());
  const current = await dependencies.store.read({
    access: input.actorType,
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
  const reason = normalizeReason(input.reason, input.action);

  if (input.action === "revoke") {
    return revokeSetupLink(input, current, reason, dependencies, now());
  }

  const customerId = requireApprovedPreflight(current);

  const currentStatus =
    current.setupLink === null
      ? null
      : whatsappSetupLinkStatus(current.setupLink, now());

  if (current.setupLink !== null && currentStatus === "expired") {
    await dependencies.store.save({
      access: input.actorType,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "setup-link-expired",
          customerId,
          reason: "El enlace de configuración alcanzó su fecha de vencimiento.",
          result: "succeeded",
          setupLinkId: requireSetupLinkProviderId(current),
        },
      ],
      clinicId: input.clinicId,
      customerId,
      setupLink: {
        createdAt: current.setupLink.createdAt,
        expiresAt: current.setupLink.expiresAt,
        kapsoSetupLinkId: requireSetupLinkProviderId(current),
        providerError: current.setupLinkProviderError,
        providerStatus: current.setupLinkProviderStatus,
        revokedAt: current.setupLink.revokedAt,
        status: "expired",
        url: current.setupLink.url,
        usedAt: current.setupLink.usedAt,
      },
    });
  }

  try {
    const remoteLinks = await dependencies.provider.listSetupLinks(customerId);
    if (input.action === "generate") {
      const existingRemote = findActiveRemoteLink(remoteLinks, now());
      if (existingRemote !== undefined) {
        await reconcileCurrentLinkBeforeReuse(
          input,
          current,
          existingRemote,
          dependencies,
          now(),
          customerId,
        );
        await revokeDuplicateRemoteLinks(
          input,
          customerId,
          remoteLinks.filter(
            (link) =>
              isWhatsAppSetupLinkUsable(link, now()) &&
              link.id !== existingRemote.id,
          ),
          dependencies,
          reason,
        );
        await dependencies.store.save({
          access: input.actorType,
          actorIdentityId: input.actorIdentityId,
          auditEvents: [
            {
              action: "setup-link-confirmed",
              customerId,
              reason: "Enlace de configuración activo confirmado en Kapso.",
              result: "succeeded",
              setupLinkId: existingRemote.id,
            },
          ],
          clinicId: input.clinicId,
          customerId,
          setupLink: toSetupLinkUpdate(existingRemote, now()),
        });
        return readAfterSave(input, dependencies.store);
      }
      await reconcileCurrentLinkBeforeCreate(
        input,
        current,
        remoteLinks,
        dependencies,
        now(),
        customerId,
      );
    }

    if (input.action === "regenerate") {
      await revokeExistingRemoteLinks(
        input,
        current,
        remoteLinks,
        dependencies,
        now(),
        reason,
      );
    }

    const created = await dependencies.provider.createSetupLink({
      customerId,
      allowedOrigin: new URL(dependencies.appUrl).origin,
      failureRedirectUrl: `${dependencies.appUrl}/configuracion/whatsapp`,
      successRedirectUrl: `${dependencies.appUrl}/configuracion/whatsapp`,
    });
    try {
      await dependencies.store.save({
        access: input.actorType,
        actorIdentityId: input.actorIdentityId,
        auditEvents: [
          {
            action:
              input.action === "regenerate"
                ? "setup-link-regenerated"
                : "setup-link-created",
            customerId,
            reason,
            result: "succeeded",
            setupLinkId: created.id,
          },
        ],
        clinicId: input.clinicId,
        customerId,
        setupLink: toSetupLinkUpdate(created, now()),
      });
    } catch (error) {
      if (!isSetupLinkUniquenessConflict(error)) throw error;
      await reconcileCreateConflict(
        input,
        customerId,
        created,
        dependencies,
        now(),
        reason,
      );
    }
    return readAfterSave(input, dependencies.store);
  } catch (error) {
    if (!isProviderFailure(error)) throw error;
    await dependencies.store.save({
      access: input.actorType,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "setup-link-provider-unavailable",
          customerId,
          reason: "Kapso no está disponible para gestionar el enlace.",
          result: "failed",
          setupLinkId: current.setupLinkProviderId,
        },
      ],
      clinicId: input.clinicId,
      customerId,
    });
    throw error;
  }
}

function requireApprovedPreflight(
  snapshot: KapsoWhatsAppOnboardingSnapshot,
): string {
  if (snapshot.customerId === null || snapshot.preflight?.status !== "passed") {
    throw new Error(
      "El preflight de WhatsApp debe estar aprobado antes de gestionar el enlace.",
    );
  }
  return snapshot.customerId;
}

async function revokeSetupLink(
  input: ManageKapsoWhatsAppSetupLinkInput,
  current: KapsoWhatsAppOnboardingSnapshot,
  reason: string,
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  now: Date,
) {
  if (current.setupLink === null) {
    throw new Error("No existe un enlace de configuración para revocar.");
  }
  const status = whatsappSetupLinkStatus(current.setupLink, now);
  if (status !== "active") {
    return current;
  }
  if (current.customerId === null) {
    throw new Error("El enlace de configuración no tiene customer de Kapso.");
  }
  const customerId = current.customerId;
  const setupLinkId = requireSetupLinkProviderId(current);

  try {
    await dependencies.provider.revokeSetupLink({
      customerId,
      setupLinkId,
    });
    await dependencies.store.save({
      access: input.actorType,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "setup-link-revoked",
          customerId,
          reason,
          result: "succeeded",
          setupLinkId,
        },
      ],
      clinicId: input.clinicId,
      customerId,
      setupLink: {
        createdAt: current.setupLink.createdAt,
        expiresAt: current.setupLink.expiresAt,
        kapsoSetupLinkId: setupLinkId,
        providerError: current.setupLinkProviderError,
        providerStatus: current.setupLinkProviderStatus,
        revokedAt: now,
        status: "revoked",
        url: current.setupLink.url,
        usedAt: current.setupLink.usedAt,
      },
    });
    return readAfterSave(input, dependencies.store);
  } catch (error) {
    if (!isProviderFailure(error)) throw error;
    await dependencies.store.save({
      access: input.actorType,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "setup-link-provider-unavailable",
          customerId,
          reason: "Kapso no está disponible para revocar el enlace.",
          result: "failed",
          setupLinkId,
        },
      ],
      clinicId: input.clinicId,
      customerId,
    });
    throw error;
  }
}

async function revokeExistingRemoteLinks(
  input: ManageKapsoWhatsAppSetupLinkInput,
  current: KapsoWhatsAppOnboardingSnapshot,
  remoteLinks: KapsoSetupLink[],
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  now: Date,
  reason: string,
) {
  if (current.customerId === null) {
    throw new Error("El onboarding no tiene customer de Kapso.");
  }
  const customerId = current.customerId;
  const currentSetupLink = current.setupLink;
  const currentProviderId =
    currentSetupLink === null ? null : requireSetupLinkProviderId(current);
  const remoteCurrentLink =
    currentProviderId === null
      ? undefined
      : remoteLinks.find((link) => link.id === currentProviderId);
  if (
    currentSetupLink !== null &&
    remoteCurrentLink !== undefined &&
    whatsappSetupLinkStatus(remoteCurrentLink, now) !== "active"
  ) {
    await persistCurrentLinkStatus(
      input,
      current,
      nonActiveSetupLinkStatus(remoteCurrentLink, now),
      "Kapso actualizó el estado del enlace anterior durante la regeneración.",
      dependencies,
      now,
      customerId,
      remoteCurrentLink,
    );
  }
  const activeRemoteLinks = remoteLinks.filter((link) =>
    isWhatsAppSetupLinkUsable(link, now),
  );
  const currentIsMissing =
    currentSetupLink !== null &&
    currentProviderId !== null &&
    remoteCurrentLink === undefined &&
    whatsappSetupLinkStatus(currentSetupLink, now) === "active" &&
    !activeRemoteLinks.some((link) => link.id === currentProviderId);
  if (currentIsMissing) {
    activeRemoteLinks.push({
      createdAt: currentSetupLink.createdAt,
      expiresAt: currentSetupLink.expiresAt,
      id: currentProviderId,
      status: "active",
      url: currentSetupLink.url,
      whatsappSetupError: null,
      whatsappSetupStatus: "pending",
    });
  }

  const uniqueLinks = new Map(activeRemoteLinks.map((link) => [link.id, link]));
  for (const link of uniqueLinks.values()) {
    await dependencies.provider.revokeSetupLink({
      customerId,
      setupLinkId: link.id,
    });
    if (currentSetupLink !== null && link.id === currentProviderId) {
      await dependencies.store.save({
        access: input.actorType,
        actorIdentityId: input.actorIdentityId,
        auditEvents: [
          {
            action: "setup-link-revoked",
            customerId,
            reason,
            result: "succeeded",
            setupLinkId: currentProviderId,
          },
        ],
        clinicId: input.clinicId,
        customerId,
        setupLink: {
          createdAt: currentSetupLink.createdAt,
          expiresAt: currentSetupLink.expiresAt,
          kapsoSetupLinkId: currentProviderId,
          providerError: current.setupLinkProviderError,
          providerStatus: current.setupLinkProviderStatus,
          revokedAt: now,
          status: "revoked",
          url: currentSetupLink.url,
          usedAt: currentSetupLink.usedAt,
        },
      });
    }
  }
}

function findActiveRemoteLink(links: KapsoSetupLink[], now: Date) {
  return links.find((link) => isWhatsAppSetupLinkUsable(link, now));
}

function assertActionAllowed(input: ManageKapsoWhatsAppSetupLinkInput) {
  if (input.actorType === "clinic-owner" && input.action !== "generate") {
    throw new Error(
      "El Médico propietario solo puede iniciar el enlace de configuración.",
    );
  }
}

function requireSetupLinkProviderId(snapshot: KapsoWhatsAppOnboardingSnapshot) {
  if (snapshot.setupLinkProviderId === null) {
    throw new Error("El enlace de configuración no tiene referencia remota.");
  }
  return snapshot.setupLinkProviderId;
}

function nonActiveSetupLinkStatus(
  link: { expiresAt: Date; status: "active" | "used" | "expired" | "revoked" },
  now: Date,
): "used" | "expired" | "revoked" {
  const status = whatsappSetupLinkStatus(link, now);
  if (status === "active") {
    throw new Error("Se esperaba un estado remoto no activo.");
  }
  return status;
}

async function reconcileCurrentLinkBeforeReuse(
  input: ManageKapsoWhatsAppSetupLinkInput,
  current: KapsoWhatsAppOnboardingSnapshot,
  remoteLink: KapsoSetupLink,
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  now: Date,
  customerId: string,
) {
  if (
    current.setupLink === null ||
    current.setupLinkProviderId === null ||
    current.setupLinkProviderId === remoteLink.id ||
    whatsappSetupLinkStatus(current.setupLink, now) !== "active"
  ) {
    return;
  }
  await dependencies.store.save({
    access: input.actorType,
    actorIdentityId: input.actorIdentityId,
    auditEvents: [
      {
        action: "setup-link-revoked",
        customerId,
        reason: "Kapso confirmó otro enlace activo para la Clínica.",
        result: "succeeded",
        setupLinkId: current.setupLinkProviderId,
      },
    ],
    clinicId: input.clinicId,
    customerId,
    setupLink: {
      createdAt: current.setupLink.createdAt,
      expiresAt: current.setupLink.expiresAt,
      kapsoSetupLinkId: current.setupLinkProviderId,
      providerError: current.setupLinkProviderError,
      providerStatus: current.setupLinkProviderStatus,
      revokedAt: now,
      status: "revoked",
      url: current.setupLink.url,
      usedAt: current.setupLink.usedAt,
    },
  });
}

async function reconcileCurrentLinkBeforeCreate(
  input: ManageKapsoWhatsAppSetupLinkInput,
  current: KapsoWhatsAppOnboardingSnapshot,
  remoteLinks: KapsoSetupLink[],
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  now: Date,
  customerId: string,
) {
  if (
    current.setupLink === null ||
    current.setupLinkProviderId === null ||
    whatsappSetupLinkStatus(current.setupLink, now) !== "active"
  ) {
    return;
  }
  const remoteLink = remoteLinks.find(
    (link) => link.id === current.setupLinkProviderId,
  );
  if (remoteLink === undefined) {
    await persistCurrentLinkStatus(
      input,
      current,
      "revoked",
      "Kapso ya no reporta el enlace activo de la Clínica.",
      dependencies,
      now,
      customerId,
    );
    return;
  }
  await persistCurrentLinkStatus(
    input,
    current,
    nonActiveSetupLinkStatus(remoteLink, now),
    "Kapso actualizó el estado del enlace de configuración.",
    dependencies,
    now,
    customerId,
    remoteLink,
  );
}

async function persistCurrentLinkStatus(
  input: ManageKapsoWhatsAppSetupLinkInput,
  current: KapsoWhatsAppOnboardingSnapshot,
  status: "used" | "expired" | "revoked",
  reason: string,
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  now: Date,
  customerId: string,
  remoteLink?: KapsoSetupLink,
) {
  const setupLinkId = requireSetupLinkProviderId(current);
  const setupLink = current.setupLink;
  if (setupLink === null) return;
  await dependencies.store.save({
    access: input.actorType,
    actorIdentityId: input.actorIdentityId,
    auditEvents: [
      {
        action: setupLinkStatusAuditAction(status),
        customerId,
        reason,
        result: "succeeded",
        setupLinkId,
      },
    ],
    clinicId: input.clinicId,
    customerId,
    setupLink: {
      createdAt: remoteLink?.createdAt ?? setupLink.createdAt,
      expiresAt: remoteLink?.expiresAt ?? setupLink.expiresAt,
      kapsoSetupLinkId: setupLinkId,
      providerError:
        remoteLink?.whatsappSetupError ?? current.setupLinkProviderError,
      providerStatus:
        remoteLink?.whatsappSetupStatus ?? current.setupLinkProviderStatus,
      revokedAt: status === "revoked" ? now : setupLink.revokedAt,
      status,
      url: remoteLink?.url ?? setupLink.url,
      usedAt: status === "used" ? now : setupLink.usedAt,
    },
  });
}

function setupLinkStatusAuditAction(
  status: "used" | "expired" | "revoked",
): "setup-link-expired" | "setup-link-revoked" | "setup-link-used" {
  if (status === "used") return "setup-link-used";
  if (status === "expired") return "setup-link-expired";
  return "setup-link-revoked";
}

async function revokeDuplicateRemoteLinks(
  input: ManageKapsoWhatsAppSetupLinkInput,
  customerId: string,
  duplicateLinks: KapsoSetupLink[],
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  reason: string,
) {
  for (const link of duplicateLinks) {
    await dependencies.provider.revokeSetupLink({
      customerId,
      setupLinkId: link.id,
    });
    await dependencies.store.save({
      access: input.actorType,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "setup-link-revoked",
          customerId,
          reason: `${reason} Se revocó un enlace duplicado.`,
          result: "succeeded",
          setupLinkId: link.id,
        },
      ],
      clinicId: input.clinicId,
      customerId,
    });
  }
}

function toSetupLinkUpdate(link: KapsoSetupLink, now: Date) {
  return {
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    kapsoSetupLinkId: link.id,
    providerError: link.whatsappSetupError,
    providerStatus: link.whatsappSetupStatus,
    revokedAt: link.status === "revoked" ? now : null,
    status: whatsappSetupLinkStatus(link, now),
    url: link.url,
    usedAt: link.status === "used" ? now : null,
  };
}

function normalizeReason(
  reason: string | undefined,
  action: ManageKapsoWhatsAppSetupLinkInput["action"],
) {
  const normalized = reason?.trim();
  return normalized === undefined || normalized === ""
    ? defaultReason[action]
    : normalized;
}

function isProviderFailure(error: unknown) {
  return (
    error instanceof KapsoProviderError ||
    error instanceof KapsoProviderUnavailableError
  );
}

function isSetupLinkUniquenessConflict(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    constraint_name?: unknown;
    message?: unknown;
  };
  return (
    candidate.code === "23505" &&
    (candidate.constraint_name ===
      "whatsapp_setup_link_active_customer_unique" ||
      (typeof candidate.message === "string" &&
        candidate.message.includes(
          "whatsapp_setup_link_active_customer_unique",
        )))
  );
}

async function reconcileCreateConflict(
  input: ManageKapsoWhatsAppSetupLinkInput,
  customerId: string,
  created: KapsoSetupLink,
  dependencies: ManageKapsoWhatsAppSetupLinkDependencies,
  now: Date,
  reason: string,
) {
  const refreshed = await dependencies.store.read({
    access: input.actorType,
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
  const keepProviderId =
    refreshed.setupLink !== null &&
    refreshed.setupLinkProviderId !== null &&
    whatsappSetupLinkStatus(refreshed.setupLink, now) === "active"
      ? refreshed.setupLinkProviderId
      : created.id;
  const remoteLinks = await dependencies.provider.listSetupLinks(customerId);
  await revokeDuplicateRemoteLinks(
    input,
    customerId,
    remoteLinks.filter(
      (link) =>
        isWhatsAppSetupLinkUsable(link, now) && link.id !== keepProviderId,
    ),
    dependencies,
    `${reason} Se reconcilió una creación concurrente.`,
  );
  if (keepProviderId === created.id) {
    await dependencies.store.save({
      access: input.actorType,
      actorIdentityId: input.actorIdentityId,
      auditEvents: [
        {
          action: "setup-link-created",
          customerId,
          reason: `${reason} Se conservó el enlace creado concurrentemente.`,
          result: "succeeded",
          setupLinkId: created.id,
        },
      ],
      clinicId: input.clinicId,
      customerId,
      setupLink: toSetupLinkUpdate(created, now),
    });
  }
}

function readAfterSave(
  input: ManageKapsoWhatsAppSetupLinkInput,
  store: KapsoWhatsAppOnboardingStore,
) {
  return store.read({
    access: input.actorType,
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
}
