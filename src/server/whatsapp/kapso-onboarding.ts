import { z } from "zod";

import { isValidE164PhoneNumber } from "~/domain/whatsapp-preflight";
import {
  hasWhatsAppSetupLinkPolicyExpiry,
  setupLinkExpiresAt,
  type WhatsAppSetupLinkStatus,
} from "~/domain/whatsapp-setup-link";

const KAPSO_PLATFORM_API_URL = "https://api.kapso.ai/platform/v1";

const customerSchema = z.object({
  external_customer_id: z.string(),
  id: z.string(),
  name: z.string(),
});

const phoneNumberSchema = z
  .object({
    customer_id: z.string(),
    display_phone_number: z.string().nullable().optional(),
    display_phone_number_normalized: z.string().nullable().optional(),
    is_coexistence: z.boolean().nullable().optional(),
    phone_number_id: z.string(),
  })
  .refine(
    (phoneNumber) =>
      (phoneNumber.display_phone_number?.trim() ?? "") !== "" ||
      (phoneNumber.display_phone_number_normalized?.trim() ?? "") !== "",
    "Kapso no devolvió un número visible para la asociación",
  );

const phoneNumbersPageSchema = z.object({
  data: z.array(phoneNumberSchema),
  meta: z
    .object({
      page: z.number().int().positive(),
      total_pages: z.number().int().positive(),
    })
    .optional(),
});

const setupLinkStatusSchema = z.enum([
  "active",
  "consumed",
  "expired",
  "revoked",
  "used",
]);

const setupLinkSchema = z.object({
  created_at: z.coerce.date(),
  expires_at: z.coerce.date(),
  id: z.string(),
  status: setupLinkStatusSchema,
  url: z.string().url(),
  whatsapp_setup_error: z.string().nullable().optional(),
  whatsapp_setup_status: z.string().nullable().optional(),
});

const setupLinksPageSchema = z.object({
  data: z.array(setupLinkSchema),
  meta: z
    .object({
      page: z.number().int().positive(),
      total_pages: z.number().int().positive(),
    })
    .optional(),
});

export const kapsoSetupLinkProviderStatuses = [
  "pending",
  "completed",
  "failed",
  "unknown",
] as const;

export type KapsoSetupLinkProviderStatus =
  (typeof kapsoSetupLinkProviderStatuses)[number];

export type KapsoCustomer = {
  externalCustomerId: string;
  id: string;
  name: string;
};

export type KapsoPhoneNumber = {
  customerId: string;
  displayPhoneNumber: string | null;
  displayPhoneNumberNormalized: string | null;
  isCoexistence: boolean | null;
  phoneNumberId: string;
};

export type KapsoSetupLink = {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  status: WhatsAppSetupLinkStatus;
  url: string;
  whatsappSetupError: string | null;
  whatsappSetupStatus: KapsoSetupLinkProviderStatus;
};

export class KapsoProviderUnavailableError extends Error {
  constructor() {
    super("Kapso no está disponible para el onboarding");
    this.name = "KapsoProviderUnavailableError";
  }
}

export class KapsoProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KapsoProviderError";
    this.status = status;
  }
}

export type KapsoOnboardingProvider = {
  createCustomer: (input: {
    externalCustomerId: string;
    name: string;
  }) => Promise<KapsoCustomer>;
  findCustomerByExternalId: (
    externalCustomerId: string,
  ) => Promise<KapsoCustomer | undefined>;
  listPhoneNumbers: () => Promise<KapsoPhoneNumber[]>;
  createSetupLink: (input: {
    allowedOrigin: string;
    customerId: string;
    failureRedirectUrl: string;
    reconnectPhoneNumber?: string;
    successRedirectUrl: string;
  }) => Promise<KapsoSetupLink>;
  listSetupLinks: (customerId: string) => Promise<KapsoSetupLink[]>;
  revokeSetupLink: (input: {
    customerId: string;
    setupLinkId: string;
  }) => Promise<KapsoSetupLink | undefined>;
};

type KapsoOnboardingProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export function createKapsoOnboardingProvider(
  options: KapsoOnboardingProviderOptions,
): KapsoOnboardingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async createCustomer(input) {
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        "/customers",
        {
          body: JSON.stringify({
            customer: {
              external_customer_id: input.externalCustomerId,
              name: input.name,
            },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const customer = toCustomer(
        parseKapsoPayload(customerSchema, payload.data),
      );
      assertCustomerMatchesExternalId(customer, input.externalCustomerId);
      return customer;
    },

    async findCustomerByExternalId(externalCustomerId) {
      const query = new URLSearchParams({
        external_customer_id: externalCustomerId,
      });
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        `/customers?${query.toString()}`,
        { method: "GET" },
      );
      const customers = parseKapsoPayload(
        z.array(customerSchema),
        payload.data,
      );
      if (customers.length > 1) {
        throw new KapsoProviderError(
          200,
          "Kapso devolvió más de un customer para la Clínica",
        );
      }
      const customer = customers[0];
      if (customer === undefined) return undefined;
      const parsedCustomer = toCustomer(customer);
      assertCustomerMatchesExternalId(parsedCustomer, externalCustomerId);
      return parsedCustomer;
    },

    async listPhoneNumbers() {
      const phoneNumbers: KapsoPhoneNumber[] = [];
      let page = 1;
      while (true) {
        const query = new URLSearchParams({
          page: String(page),
          per_page: "100",
        });
        const payload = await requestJson(
          fetchImpl,
          options.apiKey,
          `/whatsapp/phone_numbers?${query.toString()}`,
          { method: "GET" },
        );
        const response = parseKapsoPayload(phoneNumbersPageSchema, payload);
        phoneNumbers.push(
          ...response.data.map((phoneNumber) => ({
            customerId: phoneNumber.customer_id,
            displayPhoneNumber: phoneNumber.display_phone_number ?? null,
            displayPhoneNumberNormalized:
              phoneNumber.display_phone_number_normalized ?? null,
            isCoexistence: phoneNumber.is_coexistence ?? null,
            phoneNumberId: phoneNumber.phone_number_id,
          })),
        );
        if (response.meta === undefined || page >= response.meta.total_pages) {
          return phoneNumbers;
        }
        page += 1;
      }
    },

    async createSetupLink(input) {
      const allowedOrigin = requireHttpsOrigin(input.allowedOrigin);
      if (
        input.reconnectPhoneNumber !== undefined &&
        !isValidE164PhoneNumber(input.reconnectPhoneNumber)
      ) {
        throw new Error(
          "Kapso requiere un número E.164 válido para reconectar la configuración",
        );
      }
      const setupLink = {
        allowed_connection_types: ["coexistence"],
        allowed_origins: [allowedOrigin],
        failure_redirect_url: input.failureRedirectUrl,
        language: "es",
        meta_billing_mode: "partner_managed",
        provision_phone_number: false,
        ...(input.reconnectPhoneNumber === undefined
          ? {}
          : { reconnect_phone_number: input.reconnectPhoneNumber }),
        success_redirect_url: input.successRedirectUrl,
      };
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        `/customers/${encodeURIComponent(input.customerId)}/setup_links`,
        {
          body: JSON.stringify({
            setup_link: setupLink,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      return toSetupLink(parseKapsoPayload(setupLinkSchema, payload.data));
    },

    async listSetupLinks(customerId) {
      const setupLinks: KapsoSetupLink[] = [];
      let page = 1;
      while (true) {
        const query = new URLSearchParams({
          page: String(page),
          per_page: "100",
        });
        const payload = await requestJson(
          fetchImpl,
          options.apiKey,
          `/customers/${encodeURIComponent(customerId)}/setup_links?${query.toString()}`,
          { method: "GET" },
        );
        const response = parseKapsoPayload(setupLinksPageSchema, payload);
        setupLinks.push(...response.data.map(toSetupLink));
        if (response.meta === undefined || page >= response.meta.total_pages) {
          return setupLinks;
        }
        page += 1;
      }
    },

    async revokeSetupLink(input) {
      try {
        const payload = await requestJson(
          fetchImpl,
          options.apiKey,
          `/customers/${encodeURIComponent(input.customerId)}/setup_links/${encodeURIComponent(input.setupLinkId)}`,
          {
            body: JSON.stringify({ setup_link: { status: "revoked" } }),
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          },
        );
        return toSetupLink(parseKapsoPayload(setupLinkSchema, payload.data));
      } catch (error) {
        if (error instanceof KapsoProviderError && error.status === 404) {
          return undefined;
        }
        throw error;
      }
    },
  };
}

async function requestJson(
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  path: string,
  init: RequestInit,
) {
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new KapsoProviderUnavailableError();
  }

  let response: Response;
  try {
    response = await fetchImpl(`${KAPSO_PLATFORM_API_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-API-Key": apiKey,
      },
    });
  } catch {
    throw new KapsoProviderUnavailableError();
  }

  if (!response.ok) {
    throw new KapsoProviderError(
      response.status,
      "Kapso rechazó la solicitud de onboarding",
    );
  }

  try {
    return (await response.json()) as { data: unknown };
  } catch {
    throw new KapsoProviderError(
      response.status,
      "Kapso devolvió una respuesta inválida",
    );
  }
}

function parseKapsoPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  try {
    return schema.parse(payload);
  } catch {
    throw new KapsoProviderError(200, "Kapso devolvió una respuesta inválida");
  }
}

function toCustomer(customer: z.infer<typeof customerSchema>): KapsoCustomer {
  return {
    externalCustomerId: customer.external_customer_id,
    id: customer.id,
    name: customer.name,
  };
}

function assertCustomerMatchesExternalId(
  customer: KapsoCustomer,
  externalCustomerId: string,
) {
  if (customer.externalCustomerId !== externalCustomerId) {
    throw new KapsoProviderError(
      200,
      "Kapso devolvió un customer distinto al solicitado",
    );
  }
}

function toSetupLink(
  setupLink: z.infer<typeof setupLinkSchema>,
): KapsoSetupLink {
  if (
    !hasWhatsAppSetupLinkPolicyExpiry(
      setupLink.created_at,
      setupLink.expires_at,
    )
  ) {
    throw new KapsoProviderError(
      200,
      `Kapso devolvió una expiración distinta a ${setupLinkExpiresAt(setupLink.created_at).toISOString()}`,
    );
  }
  return {
    createdAt: setupLink.created_at,
    expiresAt: setupLink.expires_at,
    id: setupLink.id,
    status: normalizeSetupLinkStatus(setupLink.status),
    url: setupLink.url,
    whatsappSetupError:
      setupLink.whatsapp_setup_error?.trim() === ""
        ? null
        : setupLink.whatsapp_setup_error === null ||
            setupLink.whatsapp_setup_error === undefined
          ? null
          : "Kapso reportó un bloqueo durante la configuración.",
    whatsappSetupStatus: normalizeSetupProviderStatus(
      setupLink.whatsapp_setup_status,
    ),
  };
}

function normalizeSetupLinkStatus(
  status: z.infer<typeof setupLinkStatusSchema>,
): WhatsAppSetupLinkStatus {
  return status === "consumed" ? "used" : status;
}

function requireHttpsOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Kapso requiere un origin HTTPS válido");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Kapso requiere un origin HTTPS válido");
  }
  return url.origin;
}

function normalizeSetupProviderStatus(
  status: string | null | undefined,
): KapsoSetupLinkProviderStatus {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "pending" || normalized === "processing") {
    return "pending";
  }
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "connected" ||
    normalized === "ready" ||
    normalized === "success" ||
    normalized === "succeeded"
  ) {
    return "completed";
  }
  if (
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "error" ||
    normalized === "rejected"
  ) {
    return "failed";
  }
  return "unknown";
}
