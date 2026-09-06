import { z } from "zod";

const KAPSO_PLATFORM_API_URL = "https://api.kapso.ai/platform/v1";

const customerSchema = z.object({
  external_customer_id: z.string(),
  id: z.string(),
  name: z.string(),
});

const phoneNumberSchema = z.object({
  customer_id: z.string(),
  display_phone_number: z.string().nullable().optional(),
  display_phone_number_normalized: z.string().nullable().optional(),
  is_coexistence: z.boolean().optional(),
  phone_number_id: z.string(),
});

const phoneNumbersPageSchema = z.object({
  data: z.array(phoneNumberSchema),
  meta: z
    .object({
      page: z.number().int().positive(),
      total_pages: z.number().int().positive(),
    })
    .optional(),
});

export type KapsoCustomer = {
  externalCustomerId: string;
  id: string;
  name: string;
};

export type KapsoPhoneNumber = {
  customerId: string;
  displayPhoneNumber: string | null;
  displayPhoneNumberNormalized: string | null;
  isCoexistence: boolean;
  phoneNumberId: string;
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
      return toCustomer(parseKapsoPayload(customerSchema, payload.data));
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
      return customer === undefined ? undefined : toCustomer(customer);
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
            isCoexistence: phoneNumber.is_coexistence ?? false,
            phoneNumberId: phoneNumber.phone_number_id,
          })),
        );
        if (response.meta === undefined || page >= response.meta.total_pages) {
          return phoneNumbers;
        }
        page += 1;
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
