import { z } from "zod";

export const DEMO_REQUEST_ROLES = ["owner", "secretary", "other"] as const;
export type DemoRequestRole = (typeof DEMO_REQUEST_ROLES)[number];

export const DEMO_REQUEST_CONTACT_CHANNELS = ["email", "whatsapp"] as const;
export type DemoRequestContactChannel =
  (typeof DEMO_REQUEST_CONTACT_CHANNELS)[number];

export const DEMO_REQUEST_CONTEXTS = [
  "agenda",
  "whatsapp",
  "operations",
  "other",
] as const;
export type DemoRequestContext = (typeof DEMO_REQUEST_CONTEXTS)[number];

export const DEMO_PRIVACY_NOTICE_VERSION = "1.0";

export type DemoRequestPrivacyConsent = {
  acceptedAt: Date;
  noticeVersion: string;
};

export type DemoRequestAttribution = {
  landingPage?: string;
  referrer?: string;
  utmCampaign?: string;
  utmMedium?: string;
  utmSource?: string;
};

export type DemoRequest = {
  attribution: DemoRequestAttribution;
  clinicName: string;
  context?: DemoRequestContext;
  email: string;
  phone?: string;
  privacyConsent: DemoRequestPrivacyConsent;
  preferredContact: DemoRequestContactChannel;
  representativeName: string;
  role: DemoRequestRole;
};

const optionalAttribution = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(maxLength).optional(),
  );

const optionalContext = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.enum(DEMO_REQUEST_CONTEXTS).optional(),
);

const phone = z.preprocess(
  (value) => (value === undefined ? "" : value),
  z
    .string()
    .trim()
    .max(30)
    .refine(
      (value) => value === "" || /^\+?[0-9 ()-]+$/.test(value),
      "El teléfono no es válido",
    )
    .refine(
      (value) => value === "" || value.replace(/\D/g, "").length >= 7,
      "El teléfono no es válido",
    )
    .transform((value) => {
      if (value === "") return undefined;
      const digits = value.replace(/\D/g, "");
      return value.startsWith("+") ? `+${digits}` : digits;
    }),
);

/**
 * Contrato de entrada de la Solicitud de demo. Es estricto para que un campo
 * accidental de Paciente o información clínica nunca pase desapercibido.
 */
export const demoRequestFormSchema = z
  .object({
    clinicName: z.string().trim().min(2).max(160),
    context: optionalContext,
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    landingPage: optionalAttribution(2_048),
    phone,
    privacyConsent: z.literal("accepted"),
    preferredContact: z.enum(DEMO_REQUEST_CONTACT_CHANNELS).default("email"),
    referrer: optionalAttribution(2_048),
    representativeName: z.string().trim().min(2).max(120),
    role: z.enum(DEMO_REQUEST_ROLES),
    turnstileToken: z.string().trim().min(1).max(4_096),
    utmCampaign: optionalAttribution(120),
    utmMedium: optionalAttribution(120),
    utmSource: optionalAttribution(120),
    website: z.string().trim().max(200).default(""),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.preferredContact === "whatsapp" && value.phone === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indica un teléfono para contactarte por WhatsApp",
        path: ["phone"],
      });
    }
  });

export type DemoRequestForm = z.input<typeof demoRequestFormSchema>;
export type ParsedDemoRequestForm = z.output<typeof demoRequestFormSchema>;

export function toDemoRequest(
  form: ParsedDemoRequestForm,
  acceptedAt = new Date(),
): {
  request: DemoRequest;
  turnstileToken: string;
  website: string;
} {
  const {
    landingPage,
    referrer,
    turnstileToken,
    utmCampaign,
    utmMedium,
    utmSource,
    website,
    phone,
    ...requestFields
  } = form;

  return {
    request: {
      ...requestFields,
      privacyConsent: {
        acceptedAt,
        noticeVersion: DEMO_PRIVACY_NOTICE_VERSION,
      },
      ...(form.preferredContact === "whatsapp" && phone !== undefined
        ? { phone }
        : {}),
      attribution: {
        ...(landingPage === undefined ? {} : { landingPage }),
        ...(referrer === undefined ? {} : { referrer }),
        ...(utmCampaign === undefined ? {} : { utmCampaign }),
        ...(utmMedium === undefined ? {} : { utmMedium }),
        ...(utmSource === undefined ? {} : { utmSource }),
      },
    },
    turnstileToken,
    website,
  };
}
