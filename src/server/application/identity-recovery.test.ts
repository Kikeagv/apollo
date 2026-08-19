import { describe, expect, it, vi } from "vitest";

import {
  PasswordResetError,
  resetIdentityPassword,
  requestIdentityPasswordReset,
  type IdentityRecoveryRequestStore,
} from "./identity-recovery";

function createRecoveryDeps() {
  const countRecent = vi.fn(async () => 0);
  const record = vi.fn(async () => undefined);
  const sendResetOtp = vi.fn(async () => undefined);
  const verifyTurnstile = vi.fn(async () => true);
  return {
    countRecent,
    record,
    sendResetOtp,
    store: { countRecent, record } satisfies IdentityRecoveryRequestStore,
    verifyTurnstile,
  };
}

describe("solicitud de restablecimiento de contraseña", () => {
  it("valida Turnstile antes de cualquier efecto y rechaza tokens inválidos", async () => {
    const deps = createRecoveryDeps();
    deps.verifyTurnstile.mockResolvedValue(false);

    const result = await requestIdentityPasswordReset(
      {
        email: "ana@example.test",
        ip: "203.0.113.9",
        turnstileToken: "invalid-turnstile-token",
      },
      deps,
    );

    expect(result).toBe("turnstile-rejected");
    expect(deps.sendResetOtp).not.toHaveBeenCalled();
    expect(deps.countRecent).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("no emite correo al superar el límite por IP", async () => {
    const deps = createRecoveryDeps();
    deps.countRecent.mockResolvedValue(5);

    const result = await requestIdentityPasswordReset(
      {
        email: "ana@example.test",
        ip: "203.0.113.9",
        turnstileToken: "simulated-turnstile-token",
      },
      deps,
    );

    expect(result).toBe("rate-limited");
    expect(deps.sendResetOtp).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("envía el código con el correo normalizado y registra la solicitud", async () => {
    const deps = createRecoveryDeps();

    const result = await requestIdentityPasswordReset(
      {
        email: "  Ana@Example.test ",
        ip: "203.0.113.9",
        turnstileToken: "simulated-turnstile-token",
      },
      deps,
    );

    expect(result).toBe("sent");
    expect(deps.verifyTurnstile).toHaveBeenCalledWith({
      token: "simulated-turnstile-token",
      ip: "203.0.113.9",
    });
    expect(deps.sendResetOtp).toHaveBeenCalledWith("ana@example.test");
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        ipHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        requestedAt: expect.any(Date) as Date,
      }),
    );
  });

  it("no persiste la solicitud si el envío del código falla", async () => {
    const deps = createRecoveryDeps();
    deps.sendResetOtp.mockRejectedValue(new Error("proveedor caído"));

    await expect(
      requestIdentityPasswordReset(
        {
          email: "ana@example.test",
          ip: "203.0.113.9",
          turnstileToken: "simulated-turnstile-token",
        },
        deps,
      ),
    ).rejects.toThrow("proveedor caído");
    expect(deps.record).not.toHaveBeenCalled();
  });
});

describe("restablecimiento de contraseña", () => {
  function createResetDeps() {
    return {
      findIdentityId: vi.fn<(email: string) => Promise<string | undefined>>(
        async () => "identity-1",
      ),
      recordAudit: vi.fn(async () => undefined),
      resetPassword: vi.fn(async () => undefined),
      revokeClinicAccess: vi.fn(async () => undefined),
    };
  }

  it("revoca el acceso y audita el restablecimiento y la revocación", async () => {
    const deps = createResetDeps();

    await resetIdentityPassword(
      {
        email: "Ana@Example.test",
        otp: "123456",
        password: "Nueva-contraseña-1",
      },
      deps,
    );

    expect(deps.resetPassword).toHaveBeenCalledWith({
      email: "ana@example.test",
      otp: "123456",
      password: "Nueva-contraseña-1",
    });
    expect(deps.revokeClinicAccess).toHaveBeenCalledWith("identity-1");
    expect(deps.recordAudit.mock.calls).toEqual([
      [
        {
          action: "identity-password-reset-succeeded",
          identityId: "identity-1",
        },
      ],
      [{ action: "identity-sessions-revoked", identityId: "identity-1" }],
    ]);
  });

  it("no revoca ni audita cuando el OTP es inválido", async () => {
    const deps = createResetDeps();
    deps.resetPassword.mockRejectedValue(new PasswordResetError("inválido"));

    await expect(
      resetIdentityPassword(
        {
          email: "ana@example.test",
          otp: "000000",
          password: "Nueva-contraseña-1",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(PasswordResetError);
    expect(deps.revokeClinicAccess).not.toHaveBeenCalled();
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it("lanza PasswordResetError si la Identidad no existe tras el cambio", async () => {
    const deps = createResetDeps();
    deps.findIdentityId.mockResolvedValue(undefined);

    await expect(
      resetIdentityPassword(
        {
          email: "ana@example.test",
          otp: "123456",
          password: "Nueva-contraseña-1",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(PasswordResetError);
    expect(deps.revokeClinicAccess).not.toHaveBeenCalled();
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });
});
