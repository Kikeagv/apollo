import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createResendIdentityEmailSender,
  IDENTITY_FROM_ADDRESS,
} from "./resend-identity-email";

type FetchInit = Omit<RequestInit, "body" | "headers"> & {
  body: string;
  headers: Record<string, string>;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status = 200) {
  const fetchMock = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("adaptador Resend de correo de Identidad", () => {
  it("exige la clave de API al seleccionar Resend", () => {
    expect(() => createResendIdentityEmailSender({})).toThrow(
      "RESEND_API_KEY es obligatoria",
    );
    expect(() => createResendIdentityEmailSender({ apiKey: "" })).toThrow(
      "RESEND_API_KEY es obligatoria",
    );
  });

  it("envía el OTP de restablecimiento desde noreply@usepraxia.com", async () => {
    const fetchMock = stubFetch();
    const sender = createResendIdentityEmailSender({ apiKey: "re_test" });

    await sender.sendIdentityOtp({
      email: "ana@example.test",
      otp: "123456",
      type: "forget-password",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      FetchInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body) as {
      from: string;
      subject: string;
      text: string;
      to: string[];
    };
    expect(body).toMatchObject({
      from: IDENTITY_FROM_ADDRESS,
      to: ["ana@example.test"],
    });
    expect(body.subject).toContain("restablecer");
    expect(body.text).toContain("123456");
    expect(body.text).toContain("Expira en 5 minutos");
  });

  it("envía el OTP de inicio con asunto de verificación", async () => {
    const fetchMock = stubFetch();
    const sender = createResendIdentityEmailSender({ apiKey: "re_test" });

    await sender.sendIdentityOtp({
      email: "ana@example.test",
      otp: "654321",
      type: "sign-in",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    const body = JSON.parse(init.body) as { subject: string };
    expect(body.subject).toContain("verificación");
  });

  it("envía el aviso de Bloqueo temporal de identidad", async () => {
    const fetchMock = stubFetch();
    const sender = createResendIdentityEmailSender({ apiKey: "re_test" });

    await sender.sendPasswordBlockNotice("ana@example.test");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      FetchInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body) as {
      from: string;
      subject: string;
      text: string;
      to: string[];
    };
    expect(body.to).toEqual(["ana@example.test"]);
    expect(body.subject).toContain("bloqueado");
    expect(body.text).toContain("15 minutos");
  });

  it("propaga un rechazo del proveedor", async () => {
    stubFetch(429);
    const sender = createResendIdentityEmailSender({ apiKey: "re_test" });

    await expect(
      sender.sendPasswordBlockNotice("ana@example.test"),
    ).rejects.toThrow("estado 429");
  });
});
