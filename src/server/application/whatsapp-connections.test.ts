import { describe, expect, it, vi } from "vitest";

import {
  getWhatsAppConnection,
  type WhatsAppConnectionReader,
} from "./whatsapp-connections";

describe("lectura de la Conexión de WhatsApp", () => {
  it("consulta la conexión dentro del alcance de la Clínica", async () => {
    const connection = {
      clinicId: "clinic-1",
      connectionType: "simulated" as const,
      createdAt: new Date("2026-09-05T12:00:00.000Z"),
      customer: "simulated:clinic-1",
      lastTestAt: new Date("2026-09-05T12:00:00.000Z"),
      metadata: { mode: "simulated" },
      phoneNumberE164: null,
      phoneNumberId: null,
      provider: "simulated" as const,
      status: "ready" as const,
      updatedAt: new Date("2026-09-05T12:00:00.000Z"),
    };
    const read = vi.fn().mockResolvedValue(connection);
    const reader: WhatsAppConnectionReader = { read };

    await expect(
      getWhatsAppConnection(
        { clinicId: "clinic-1", identityId: "owner-1" },
        reader,
      ),
    ).resolves.toEqual(connection);
    expect(read).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
    });
  });

  it("representa una conexión ausente sin inventar un proveedor", async () => {
    const reader: WhatsAppConnectionReader = {
      read: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      getWhatsAppConnection(
        { clinicId: "clinic-1", identityId: "owner-1" },
        reader,
      ),
    ).resolves.toBeUndefined();
  });
});
