export type VoiceTranscriptionSettingsStore = {
  getVoiceTranscriptionSettings(input: {
    clinicId: string;
    identityId: string;
  }): Promise<boolean | undefined>;
  setVoiceTranscriptionSettings(input: {
    clinicId: string;
    enabled: boolean;
    identityId: string;
  }): Promise<boolean>;
};

export class VoiceTranscriptionSettingsAccessError extends Error {
  constructor() {
    super(
      "Solo el Médico propietario puede configurar la Transcripción de nota de voz",
    );
    this.name = "VoiceTranscriptionSettingsAccessError";
  }
}

/** Consulta si la Clínica autorizó procesar notas de voz. */
export async function getVoiceTranscriptionSettings(
  input: { clinicId: string; identityId: string },
  store: VoiceTranscriptionSettingsStore,
) {
  const enabled = await store.getVoiceTranscriptionSettings(input);
  if (enabled === undefined) throw new VoiceTranscriptionSettingsAccessError();
  return { enabled };
}

/** Activa o desactiva la capacidad, reservada al Médico propietario. */
export async function setVoiceTranscriptionSettings(
  input: { clinicId: string; enabled: boolean; identityId: string },
  store: VoiceTranscriptionSettingsStore,
) {
  if (!(await store.setVoiceTranscriptionSettings(input))) {
    throw new VoiceTranscriptionSettingsAccessError();
  }
  return { enabled: input.enabled };
}
