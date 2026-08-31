import { describe, expect, it, vi } from "vitest";

import {
  EscalationNotificationSettingsAccessError,
  getEscalationNotificationSettings,
  listConversationEscalations,
  resolveConversationEscalation,
  setEscalationNotificationSettings,
} from "./conversation-escalations";

describe("Escalamientos humanos", () => {
  it("expone el Escalamiento de una Clínica y permite cerrarlo", async () => {
    const calls: string[] = [];
    const store = {
      async listConversationEscalations() {
        calls.push("list");
        return [
          {
            contact: { id: "contact-1", name: "Ana" },
            createdAt: new Date("2026-08-14T12:00:00.000Z"),
            id: "escalation-1",
            trigger: "human-request" as const,
          },
        ];
      },
      async resolveConversationEscalation() {
        calls.push("resolve");
        return true;
      },
    };

    await expect(
      listConversationEscalations(
        { clinicId: "clinic-1", identityId: "identity-1" },
        store,
      ),
    ).resolves.toMatchObject([
      { id: "escalation-1", trigger: "human-request" },
    ]);
    await expect(
      resolveConversationEscalation(
        {
          clinicId: "clinic-1",
          escalationId: "escalation-1",
          identityId: "identity-1",
        },
        store,
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual(["list", "resolve"]);
  });
});

describe("avisos de Escalamiento", () => {
  it("normaliza el teléfono y guarda la configuración del propietario", async () => {
    let settings = {
      enabled: false,
      secretaryPhoneE164: null as string | null,
    };
    const store = {
      async getEscalationNotificationSettings() {
        return settings;
      },
      async setEscalationNotificationSettings(input: typeof settings) {
        settings = input;
        return true;
      },
    };

    await expect(
      getEscalationNotificationSettings(
        { clinicId: "clinic-1", identityId: "owner-1" },
        store,
      ),
    ).resolves.toEqual({ enabled: false, secretaryPhoneE164: null });
    await expect(
      setEscalationNotificationSettings(
        {
          clinicId: "clinic-1",
          enabled: true,
          identityId: "owner-1",
          secretaryPhoneE164: " +50370000000 ",
        },
        store,
      ),
    ).resolves.toEqual({
      enabled: true,
      secretaryPhoneE164: "+50370000000",
    });
  });

  it("valida el teléfono antes de habilitar el aviso", async () => {
    const setSettings = vi.fn(async () => true);
    const store = {
      getEscalationNotificationSettings: async () => ({
        enabled: false,
        secretaryPhoneE164: null,
      }),
      setEscalationNotificationSettings: setSettings,
    };

    await expect(
      setEscalationNotificationSettings(
        {
          clinicId: "clinic-1",
          enabled: true,
          identityId: "owner-1",
          secretaryPhoneE164: null,
        },
        store,
      ),
    ).rejects.toThrow("El aviso requiere un número E.164 de secretaria");
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("rechaza la configuración cuando la identidad no es propietaria", async () => {
    const store = {
      getEscalationNotificationSettings: async () => undefined,
      setEscalationNotificationSettings: async () => false,
    };

    await expect(
      getEscalationNotificationSettings(
        { clinicId: "clinic-1", identityId: "doctor-1" },
        store,
      ),
    ).rejects.toBeInstanceOf(EscalationNotificationSettingsAccessError);
    await expect(
      setEscalationNotificationSettings(
        {
          clinicId: "clinic-1",
          enabled: false,
          identityId: "secretary-1",
          secretaryPhoneE164: null,
        },
        store,
      ),
    ).rejects.toBeInstanceOf(EscalationNotificationSettingsAccessError);
  });
});
