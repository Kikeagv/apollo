import { describe, expect, it, vi } from "vitest";

import type { NoShowPolicy } from "~/domain/whatsapp-operational-policies";

import {
  NoShowPolicyAccessError,
  getNoShowPolicy,
  setNoShowPolicy,
  type NoShowPolicyStore,
} from "./no-show-policy";

describe("caso de uso de Política de inasistencia", () => {
  it("lee y guarda la política para el Médico propietario", async () => {
    let current: NoShowPolicy = "alert";
    const store: NoShowPolicyStore = {
      getNoShowPolicy: vi.fn(async () => current),
      setNoShowPolicy: vi.fn(
        async (input: Parameters<NoShowPolicyStore["setNoShowPolicy"]>[0]) => {
          current = input.policy;
          return true;
        },
      ),
    };

    await expect(
      getNoShowPolicy({ clinicId: "clinic-1", identityId: "owner-1" }, store),
    ).resolves.toBe("alert");
    await expect(
      setNoShowPolicy(
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          policy: "cancel-after-third-reminder",
        },
        store,
      ),
    ).resolves.toBe("cancel-after-third-reminder");
    expect(current).toBe("cancel-after-third-reminder");
  });

  it("rechaza leer o guardar sin alcance de propietario", async () => {
    const store: NoShowPolicyStore = {
      getNoShowPolicy: vi.fn(async () => undefined),
      setNoShowPolicy: vi.fn(async () => false),
    };

    await expect(
      getNoShowPolicy({ clinicId: "clinic-1", identityId: "doctor-1" }, store),
    ).rejects.toBeInstanceOf(NoShowPolicyAccessError);
    await expect(
      setNoShowPolicy(
        {
          clinicId: "clinic-1",
          identityId: "secretary-1",
          policy: "alert",
        },
        store,
      ),
    ).rejects.toBeInstanceOf(NoShowPolicyAccessError);
  });

  it("no envía una política que el dominio no reconoce al store", async () => {
    const setPolicy = vi.fn(async () => true);
    const store: NoShowPolicyStore = {
      getNoShowPolicy: vi.fn(async (): Promise<NoShowPolicy> => "alert"),
      setNoShowPolicy: setPolicy,
    };

    await expect(
      setNoShowPolicy(
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          policy: "unsupported-policy" as NoShowPolicy,
        },
        store,
      ),
    ).rejects.toThrow("La política de inasistencia no es válida");
    expect(setPolicy).not.toHaveBeenCalled();
  });
});
