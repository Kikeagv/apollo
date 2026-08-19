import { describe, expect, it, vi } from "vitest";

import {
  TURNSTILE_SITEVERIFY_URL,
  createCloudflareTurnstileVerifier,
  createSimulatedTurnstileVerifier,
} from "./turnstile";

describe("verificador Turnstile simulado", () => {
  it("acepta únicamente el token fijo de desarrollo", async () => {
    const verifier = createSimulatedTurnstileVerifier();
    await expect(
      verifier.verify({ token: "simulated-turnstile-token" }),
    ).resolves.toEqual({ ok: true });
  });

  it("rechaza cualquier otro token", async () => {
    const verifier = createSimulatedTurnstileVerifier();
    await expect(verifier.verify({ token: "" })).resolves.toEqual({
      ok: false,
    });
    await expect(
      verifier.verify({ token: "invalid-turnstile-token" }),
    ).resolves.toEqual({ ok: false });
    await expect(
      verifier.verify({ token: "token-arbitrario" }),
    ).resolves.toEqual({ ok: false });
  });
});

describe("verificador Turnstile de Cloudflare", () => {
  it("exige la clave secreta", () => {
    expect(() => createCloudflareTurnstileVerifier({})).toThrow(
      "TURNSTILE_SECRET_KEY es obligatoria",
    );
  });

  it("valida el token contra siteverify con la IP del solicitante", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const verifier = createCloudflareTurnstileVerifier({
      secretKey: "turnstile-secret",
    });

    await expect(
      verifier.verify({ token: "turnstile-token", ip: "203.0.113.9" }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      Omit<RequestInit, "body"> & { body: string },
    ];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("secret")).toBe("turnstile-secret");
    expect(body.get("response")).toBe("turnstile-token");
    expect(body.get("remoteip")).toBe("203.0.113.9");
    expect(body.get("idempotency_key")).toMatch(/^[0-9a-f]{64}$/);
    vi.unstubAllGlobals();
  });

  it("devuelve fallo ante success:false o un error del proveedor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false }), { status: 200 }),
      ),
    );
    const verifier = createCloudflareTurnstileVerifier({
      secretKey: "turnstile-secret",
    });
    await expect(
      verifier.verify({ token: "turnstile-token" }),
    ).resolves.toEqual({ ok: false });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    await expect(
      verifier.verify({ token: "turnstile-token" }),
    ).resolves.toEqual({ ok: false });
    vi.unstubAllGlobals();
  });
});
