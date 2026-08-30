import { describe, expect, it, vi } from "vitest";

import { handleDemoRequest } from "./handler";

function createRouteDependencies() {
  const countRecent = vi.fn(async () => 0);
  const reserve = vi.fn(async () => true);
  const sendDemoEmail = vi.fn(async () => undefined);
  const verifyTurnstile = vi.fn(async () => true);

  return {
    countRecent,
    deliveryFailed: vi.fn(),
    ip: "203.0.113.68",
    publicSiteUrl: "https://www.usepraxia.com",
    rateLimitStore: { countRecent, reserve },
    reserve,
    sendDemoEmail,
    verifyTurnstile,
  };
}

function formRequest(
  values: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return new Request("https://app.usepraxia.com/api/demo", {
    body: new URLSearchParams(values),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    method: "POST",
  });
}

describe("adaptador HTTP de Solicitud de demo", () => {
  it("acepta FormData nativo y redirige con 303 a la confirmación pública", async () => {
    const deps = createRouteDependencies();

    const response = await handleDemoRequest(
      formRequest({
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token",
        website: "",
      }),
      deps,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://www.usepraxia.com/demo/recibido",
    );
    expect(deps.sendDemoEmail).toHaveBeenCalledOnce();
  });

  it("devuelve un error accesible y fallback mailto si el correo falla", async () => {
    const deps = createRouteDependencies();
    deps.sendDemoEmail.mockRejectedValue(new Error("fallo de Resend"));

    const response = await handleDemoRequest(
      formRequest({
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "owner",
        turnstileToken: "turnstile-token",
        website: "",
      }),
      deps,
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(body).toContain('role="alert"');
    expect(body).toContain("mailto:contact@enriqueagv.com");
    expect(body).not.toContain("ana@example.test");
    expect(deps.deliveryFailed).toHaveBeenCalledWith({
      errorName: "Error",
      provider: "resend",
    });
  });

  it("usa CF-Connecting-IP como origen confiable para el límite", async () => {
    const deps = createRouteDependencies();
    const request = formRequest(
      {
        clinicName: "Clínica Aurora",
        email: "ana@example.test",
        representativeName: "Ana Reyes",
        role: "secretary",
        turnstileToken: "turnstile-token",
        website: "",
      },
      {
        "cf-connecting-ip": "198.51.100.68",
        "x-forwarded-for": "203.0.113.68",
      },
    );

    await handleDemoRequest(request, { ...deps, ip: undefined });

    expect(deps.verifyTurnstile).toHaveBeenCalledWith({
      ip: "198.51.100.68",
      token: "turnstile-token",
    });
  });
});
