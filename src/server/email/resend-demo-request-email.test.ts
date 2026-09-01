import { afterEach, describe, expect, it, vi } from "vitest";

import type { DemoRequest } from "~/domain/demo-request";

import {
  DEMO_REQUEST_EMAIL_TO,
  createResendDemoRequestEmailSender,
} from "./resend-demo-request-email";

type FetchInit = Omit<RequestInit, "body" | "headers"> & {
  body: string;
  headers: Record<string, string>;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const request: DemoRequest = {
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
  privacyConsent: {
    acceptedAt: new Date("2026-08-31T20:00:00.000Z"),
    noticeVersion: "1.0",
  },
  preferredContact: "whatsapp",
  representativeName: "Ana Reyes",
  role: "owner",
};

describe("adaptador Resend de Solicitud de demo", () => {
  it("exige la clave de API", () => {
    expect(() => createResendDemoRequestEmailSender({})).toThrow(
      "RESEND_API_KEY es obligatoria",
    );
  });

  it("envía al buzón comercial el rol y contexto sin secretos", async () => {
    const fetchMock = stubFetch();
    const sender = createResendDemoRequestEmailSender({ apiKey: "re_test" });

    await sender.sendDemoRequest(request);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      FetchInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body) as {
      subject: string;
      text: string;
      to: string[];
    };

    expect(body.to).toEqual([DEMO_REQUEST_EMAIL_TO]);
    expect(body.subject).toContain("demo");
    expect(body.text).toContain("Médico propietario");
    expect(body.text).toContain("Clínica Aurora");
    expect(body.text).toContain("Agenda y capacidad de atención");
    expect(body.text).toContain("google");
    expect(body.text).toContain("Aviso aceptado: versión 1.0");
    expect(body.text).toContain(
      "Aceptado en servidor: 2026-08-31T20:00:00.000Z",
    );
    expect(body.text).not.toContain("turnstile-token");
    expect(body.text).not.toContain("203.0.113.9");
  });

  it("no entrega el teléfono si el canal elegido es correo", async () => {
    const fetchMock = stubFetch();
    const sender = createResendDemoRequestEmailSender({ apiKey: "re_test" });

    await sender.sendDemoRequest({
      ...request,
      preferredContact: "email",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    const body = JSON.parse(init.body) as { text: string };
    expect(body.text).not.toContain("+50370000000");
  });

  it("propaga un rechazo de Resend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const sender = createResendDemoRequestEmailSender({ apiKey: "re_test" });

    await expect(sender.sendDemoRequest(request)).rejects.toThrow("estado 503");
  });
});
