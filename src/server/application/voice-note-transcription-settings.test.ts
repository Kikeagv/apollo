import { describe, expect, it } from "vitest";

import {
  VoiceTranscriptionSettingsAccessError,
  getVoiceTranscriptionSettings,
  setVoiceTranscriptionSettings,
} from "./voice-note-transcription-settings";

describe("configuración de Transcripción de nota de voz", () => {
  it("permite al Médico propietario activar la capacidad por Clínica", async () => {
    let enabled = false;
    const store = {
      async getVoiceTranscriptionSettings() {
        return enabled;
      },
      async setVoiceTranscriptionSettings(input: { enabled: boolean }) {
        enabled = input.enabled;
        return true;
      },
    };

    await expect(
      getVoiceTranscriptionSettings(
        { clinicId: "clinic-1", identityId: "identity-1" },
        store,
      ),
    ).resolves.toEqual({ enabled: false });
    await expect(
      setVoiceTranscriptionSettings(
        { clinicId: "clinic-1", enabled: true, identityId: "identity-1" },
        store,
      ),
    ).resolves.toEqual({ enabled: true });
  });

  it("rechaza configurar la capacidad sin acceso de Médico propietario", async () => {
    const store = {
      async getVoiceTranscriptionSettings() {
        return undefined;
      },
      async setVoiceTranscriptionSettings() {
        return false;
      },
    };

    await expect(
      getVoiceTranscriptionSettings(
        { clinicId: "clinic-1", identityId: "identity-1" },
        store,
      ),
    ).rejects.toBeInstanceOf(VoiceTranscriptionSettingsAccessError);
    await expect(
      setVoiceTranscriptionSettings(
        { clinicId: "clinic-1", enabled: true, identityId: "identity-1" },
        store,
      ),
    ).rejects.toBeInstanceOf(VoiceTranscriptionSettingsAccessError);
  });
});
