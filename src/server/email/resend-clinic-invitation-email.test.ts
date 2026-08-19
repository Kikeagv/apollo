import { afterEach, describe, expect, it, vi } from "vitest";

import { createResendClinicInvitationEmailSender } from "./resend-clinic-invitation-email";
import { IDENTITY_FROM_ADDRESS } from "./resend-identity-email";

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

describe("adaptador Resend de invitaciones de clínica", () => {
  it("exige la clave de API al seleccionar Resend", () => {
    expect(() => createResendClinicInvitationEmailSender({})).toThrow(
      "RESEND_API_KEY es obligatoria",
    );
    expect(() =>
      createResendClinicInvitationEmailSender({ apiKey: "" }),
    ).toThrow("RESEND_API_KEY es obligatoria");
  });

  it("envía la invitación del médico propietario con el enlace de activación", async () => {
    const fetchMock = stubFetch();
    const sender = createResendClinicInvitationEmailSender({
      apiKey: "re_test",
    });

    await sender.sendOwnerInvitation({
      clinicName: "Clínica Aurora",
      expiresAt: new Date("2026-08-22T00:00:00Z"),
      ownerEmail: "ana@example.test",
      ownerName: "Dra. Ana Reyes",
      token: "token-abc",
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
    expect(body.from).toBe(IDENTITY_FROM_ADDRESS);
    expect(body.to).toEqual(["ana@example.test"]);
    expect(body.subject).toContain("Clínica Aurora");
    expect(body.text).toContain("Dra. Ana Reyes");
    expect(body.text).toContain("/activar-invitacion?token=token-abc");
    expect(body.text).toContain("2026-08-22T00:00:00.000Z");
  });

  it("envía la invitación de un Médico adicional al destinatario", async () => {
    const fetchMock = stubFetch();
    const sender = createResendClinicInvitationEmailSender({
      apiKey: "re_test",
    });

    await sender.sendDoctorInvitation({
      clinicName: "Clínica Aurora",
      expiresAt: new Date("2026-08-23T00:00:00Z"),
      recipientEmail: "sofia@example.test",
      recipientName: "Dra. Sofía Molina",
      token: "token-dr-1",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      FetchInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body) as {
      subject: string;
      text: string;
      to: string[];
    };
    expect(body.to).toEqual(["sofia@example.test"]);
    expect(body.subject).toContain("Clínica Aurora");
    expect(body.text).toContain("Dra. Sofía Molina");
    expect(body.text).toContain("/activar-invitacion?token=token-dr-1");
  });

  it("propaga un rechazo del proveedor", async () => {
    stubFetch(429);
    const sender = createResendClinicInvitationEmailSender({
      apiKey: "re_test",
    });

    await expect(
      sender.sendOwnerInvitation({
        clinicName: "Clínica Aurora",
        expiresAt: new Date("2026-08-22T00:00:00Z"),
        ownerEmail: "ana@example.test",
        ownerName: "Dra. Ana Reyes",
        token: "token-abc",
      }),
    ).rejects.toThrow("estado 429");
  });
});
