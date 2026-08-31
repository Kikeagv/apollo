import { describe, expect, it } from "vitest";

import {
  DEMO_PRIVACY_NOTICE_VERSION,
  demoRequestFormSchema,
  toDemoRequest,
} from "./demo-request";

describe("contrato de Solicitud de demo", () => {
  it("normaliza el contacto y separa atribución de datos de entrega", () => {
    const parsed = demoRequestFormSchema.parse({
      clinicName: " Clínica Aurora ",
      context: "agenda",
      email: " ANA@EXAMPLE.TEST ",
      landingPage: "/demo",
      phone: "+503 7000-0000",
      privacyConsent: "accepted",
      representativeName: " Ana Reyes ",
      role: "owner",
      turnstileToken: "turnstile-token",
      utmSource: "google",
      website: "",
    });

    const acceptedAt = new Date("2026-08-31T20:00:00.000Z");

    expect(toDemoRequest(parsed, acceptedAt)).toEqual({
      request: {
        attribution: {
          landingPage: "/demo",
          utmSource: "google",
        },
        clinicName: "Clínica Aurora",
        context: "agenda",
        email: "ana@example.test",
        preferredContact: "email",
        privacyConsent: {
          acceptedAt,
          noticeVersion: DEMO_PRIVACY_NOTICE_VERSION,
        },
        representativeName: "Ana Reyes",
        role: "owner",
      },
      turnstileToken: "turnstile-token",
      website: "",
    });
  });

  it("exige teléfono para WhatsApp y no acepta campos clínicos", () => {
    expect(
      demoRequestFormSchema.safeParse({
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        preferredContact: "whatsapp",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token",
        website: "",
      }).success,
    ).toBe(false);

    expect(
      demoRequestFormSchema.safeParse({
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        context: "Paciente con diagnóstico",
        patientName: "Paciente no permitido",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token",
        website: "",
      }).success,
    ).toBe(false);
  });

  it("exige una aceptación explícita del aviso de privacidad", () => {
    const baseInput = {
      clinicName: "Clínica Aurora",
      email: "ana@example.test",
      representativeName: "Ana Reyes",
      role: "owner",
      turnstileToken: "turnstile-token",
      website: "",
    } as const;

    expect(demoRequestFormSchema.safeParse(baseInput).success).toBe(false);
    expect(
      demoRequestFormSchema.safeParse({
        ...baseInput,
        privacyConsent: "not-accepted",
      }).success,
    ).toBe(false);
    expect(
      demoRequestFormSchema.safeParse({
        ...baseInput,
        privacyConsent: "accepted",
      }).success,
    ).toBe(true);
  });
});
