import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("arranque del correo de Solicitud de demo", () => {
  it("carga durante el build de Next aunque el modo simulado sea de producción inválido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("IDENTITY_EMAIL_DELIVERY", "simulated");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-prueba");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/panacea");

    const loadedModule = await import("./demo-request-email");
    expect(loadedModule.demoRequestEmailSender).toBeTypeOf("function");
  });
});
