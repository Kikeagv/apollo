import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("arranque del correo de Identidad", () => {
  it("falla al cargar el módulo si la entrega queda en simulated en producción", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IDENTITY_EMAIL_DELIVERY", "simulated");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-prueba");
    // Import dinámico intencional: verifica que la carga del módulo falle al
    // arrancar; un import estático se cachearía antes de fijar el entorno.
    await expect(import("./identity-email")).rejects.toThrow(
      "IDENTITY_EMAIL_DELIVERY=simulated no está permitido en producción",
    );
  });

  it("carga sin error fuera de producción", async () => {
    const loadedModule = await import("./identity-email");
    expect(loadedModule.identityEmailSender).toBeTypeOf("function");
  });

  it("carga durante el build de Next aunque el modo simulado sea de producción inválido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("IDENTITY_EMAIL_DELIVERY", "simulated");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-prueba");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/panacea");

    const loadedModule = await import("./identity-email");
    expect(loadedModule.identityEmailSender).toBeTypeOf("function");
  });
});
