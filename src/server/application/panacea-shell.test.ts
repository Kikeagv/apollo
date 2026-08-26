import { describe, expect, it, vi } from "vitest";

import {
  createPanaceaRouteAccess,
  type PanaceaSessionContext,
} from "./panacea-shell";

const ownerContext: PanaceaSessionContext = {
  clinic: {
    clinicId: "clinic-1",
    clinicName: "Clínica Aurora",
    identityId: "identity-1",
    role: "owner",
  },
  user: {
    email: "ana@example.test",
    id: "identity-1",
    name: "Dra. Ana",
  },
};

describe("acceso de rutas de Panacea", () => {
  it("distingue una sesión ausente", async () => {
    const readContext = vi.fn(async () => undefined);
    const access = createPanaceaRouteAccess(readContext);

    await expect(access.resolve("calendar")).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  it("rechaza una ruta fuera del rol aunque exista una sesión válida", async () => {
    const secretaryContext: PanaceaSessionContext = {
      ...ownerContext,
      clinic: { ...ownerContext.clinic, role: "secretary" },
    };
    const access = createPanaceaRouteAccess(
      vi.fn(async () => secretaryContext),
    );

    await expect(access.resolve("settings")).resolves.toEqual({
      context: secretaryContext,
      status: "forbidden",
    });
  });

  it("devuelve el contexto autorizado para que el shell lo reutilice", async () => {
    const access = createPanaceaRouteAccess(vi.fn(async () => ownerContext));

    await expect(access.resolve("calendar")).resolves.toEqual({
      context: ownerContext,
      status: "allowed",
    });
  });
});
