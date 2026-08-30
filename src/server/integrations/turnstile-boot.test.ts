import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("arranque de la verificación Turnstile", () => {
  it("falla al cargar el módulo si la verificación queda en simulated en producción", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_VERIFICATION", "simulated");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-prueba");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/panacea");

    // Import dinámico intencional: verifica que la carga del módulo falle al
    // arrancar; un import estático se cachearía antes de fijar el entorno.
    await expect(import("./turnstile")).rejects.toThrow(
      "TURNSTILE_VERIFICATION=simulated no está permitido en producción",
    );
  });

  it("carga sin error fuera de producción", async () => {
    const loadedModule = await import("./turnstile");
    expect(loadedModule.turnstileVerifier).toBeTypeOf("function");
  });

  it("carga durante el build de Next aunque el modo simulado sea de producción inválido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("TURNSTILE_VERIFICATION", "simulated");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-prueba");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/panacea");

    const loadedModule = await import("./turnstile");
    expect(loadedModule.turnstileVerifier).toBeTypeOf("function");
  });
});
