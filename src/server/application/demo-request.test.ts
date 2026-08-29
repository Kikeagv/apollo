import { describe, expect, it, vi } from "vitest";

import { submitDemoRequest } from "./demo-request";

function createDemoRequestDependencies() {
  const reserve = vi.fn(async () => true);
  const sendDemoEmail = vi.fn(async () => undefined);
  const verifyTurnstile = vi.fn(async () => true);
  const deliveryFailed = vi.fn();

  return {
    deliveryFailed,
    rateLimitStore: { countRecent: vi.fn(async () => 0), reserve },
    reserve,
    sendDemoEmail,
    verifyTurnstile,
  };
}

describe("Solicitud de demo", () => {
  it("entrega una solicitud válida con el payload comercial normalizado", async () => {
    const deps = createDemoRequestDependencies();

    const result = await submitDemoRequest(
      {
        clinicName: "  Clínica Aurora  ",
        context: "agenda",
        email: "  Ana@Example.test ",
        landingPage: "/demo",
        phone: "+503 7000-0000",
        preferredContact: "whatsapp",
        referrer: "https://www.usepraxia.com/",
        representativeName: "  Ana Reyes ",
        role: "owner",
        turnstileToken: "turnstile-token",
        utmCampaign: "piloto",
        utmMedium: "landing",
        utmSource: "google",
        website: "",
      },
      {
        ip: "203.0.113.9",
        ...deps,
      },
    );

    expect(result).toEqual({ status: "accepted" });
    expect(deps.verifyTurnstile).toHaveBeenCalledWith({
      ip: "203.0.113.9",
      token: "turnstile-token",
    });
    expect(deps.sendDemoEmail).toHaveBeenCalledWith({
      attribution: {
        landingPage: "/demo",
        referrer: "https://www.usepraxia.com/",
        utmCampaign: "piloto",
        utmMedium: "landing",
        utmSource: "google",
      },
      clinicName: "Clínica Aurora",
      context: "agenda",
      email: "ana@example.test",
      phone: "+50370000000",
      preferredContact: "whatsapp",
      representativeName: "Ana Reyes",
      role: "owner",
    });
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        emailHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        ipHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        since: expect.any(Date) as Date,
        requestedAt: expect.any(Date) as Date,
      }),
    );
    expect(deps.deliveryFailed).not.toHaveBeenCalled();
  });

  it("rechaza datos incompletos y cualquier campo de Paciente o clínico", async () => {
    const deps = createDemoRequestDependencies();

    const result = await submitDemoRequest(
      {
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        patientName: "Paciente no permitido",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token",
        website: "",
      },
      { ip: "203.0.113.9", ...deps },
    );

    expect(result).toEqual({ status: "invalid" });
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect(deps.sendDemoEmail).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it("valida Turnstile antes de consultar límites o enviar correo", async () => {
    const deps = createDemoRequestDependencies();
    deps.verifyTurnstile.mockResolvedValue(false);

    const result = await submitDemoRequest(
      {
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "secretary",
        turnstileToken: "invalid-token",
        website: "",
      },
      { ip: "203.0.113.9", ...deps },
    );

    expect(result).toEqual({ status: "turnstile-rejected" });
    expect(deps.verifyTurnstile).toHaveBeenCalledOnce();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.sendDemoEmail).not.toHaveBeenCalled();
  });

  it("falla de forma controlada si Turnstile no está disponible", async () => {
    const deps = createDemoRequestDependencies();
    deps.verifyTurnstile.mockRejectedValue(new Error("servicio no disponible"));

    const result = await submitDemoRequest(
      {
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "secretary",
        turnstileToken: "turnstile-token",
        website: "",
      },
      { ip: "203.0.113.9", ...deps },
    );

    expect(result).toEqual({ status: "turnstile-rejected" });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.sendDemoEmail).not.toHaveBeenCalled();
  });

  it("descarta la trampa honeypot sin ejecutar efectos comerciales", async () => {
    const deps = createDemoRequestDependencies();

    const result = await submitDemoRequest(
      {
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "other",
        turnstileToken: "turnstile-token",
        website: "https://bot.example.test",
      },
      { ip: "203.0.113.9", ...deps },
    );

    expect(result).toEqual({ status: "honeypot-rejected" });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.sendDemoEmail).not.toHaveBeenCalled();
  });

  it("bloquea cuando se alcanza el límite por IP o por correo", async () => {
    const deps = createDemoRequestDependencies();
    deps.reserve.mockResolvedValue(false);

    const result = await submitDemoRequest(
      {
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token",
        website: "",
      },
      { ip: "203.0.113.9", ...deps },
    );

    expect(result).toEqual({ status: "rate-limited" });
    expect(deps.reserve).toHaveBeenCalledOnce();
    expect(deps.sendDemoEmail).not.toHaveBeenCalled();
  });

  it("devuelve fallo y diagnóstico redactado si Resend no entrega el correo", async () => {
    const deps = createDemoRequestDependencies();
    deps.sendDemoEmail.mockRejectedValue(
      new Error("token secreto y ana@example.test no deben registrarse"),
    );

    const result = await submitDemoRequest(
      {
        clinicName: "Clínica Aurora",
        context: "agenda",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token-secret",
        website: "",
      },
      { ip: "203.0.113.9", ...deps },
    );

    expect(result).toEqual({ status: "delivery-failed" });
    expect(deps.deliveryFailed).toHaveBeenCalledWith({
      errorName: "Error",
      provider: "resend",
    });
    expect(deps.reserve).toHaveBeenCalledOnce();
  });
});
