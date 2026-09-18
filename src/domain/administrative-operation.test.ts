import { describe, expect, it } from "vitest";

import {
  createAdministrativeOperationKey,
  getAdministrativeOperationFeedback,
} from "./administrative-operation";

describe("operaciones administrativas", () => {
  it("crea una clave estable y separada por tipo de operación", () => {
    expect(
      createAdministrativeOperationKey("transfer-payment", "attempt-1"),
    ).toBe("transfer-payment:attempt-1");
    expect(
      createAdministrativeOperationKey("support-session", "attempt-1"),
    ).toBe("support-session:attempt-1");
  });

  it("distingue validación pendiente, procesamiento, éxito y fallo recuperable", () => {
    expect(
      getAdministrativeOperationFeedback({
        attempted: true,
        isValid: false,
        isPending: false,
        isSuccess: false,
        isError: false,
      }),
    ).toMatchObject({ status: "validation-pending" });
    expect(
      getAdministrativeOperationFeedback({
        attempted: true,
        isValid: true,
        isPending: true,
        isSuccess: false,
        isError: false,
      }),
    ).toMatchObject({ status: "pending" });
    expect(
      getAdministrativeOperationFeedback({
        attempted: true,
        isValid: true,
        isPending: false,
        isSuccess: true,
        isError: false,
        operationKey: "transfer-payment:attempt-1",
      }),
    ).toMatchObject({
      operationKey: "transfer-payment:attempt-1",
      status: "succeeded",
    });
    expect(
      getAdministrativeOperationFeedback({
        attempted: true,
        isValid: true,
        isPending: false,
        isSuccess: false,
        isError: true,
        errorMessage: "La conexión expiró",
      }),
    ).toMatchObject({
      canRetry: true,
      message: "La conexión expiró",
      status: "failed",
    });
  });
});
