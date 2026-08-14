/**
 * Puerto de transcripción intercambiable. El adaptador real usará
 * gpt-transcribe; cada adaptador normaliza Ogg/Opus temporalmente cuando lo
 * requiera el proveedor y elimina ese temporal antes de devolver el texto.
 */
export type AudioContentType =
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/ogg"
  | "audio/opus"
  | "audio/wav"
  | "audio/webm";

export type AudioTranscriber = {
  transcribe(input: {
    audio: Uint8Array;
    contentType: AudioContentType;
    model: "gpt-transcribe";
  }): Promise<string>;
};

export type SimulatedAudioTranscriber = AudioTranscriber & {
  attempts: Array<{
    byteLength: number;
    contentType: AudioContentType;
    model: "gpt-transcribe";
    normalization: "ogg-opus-to-wav" | null;
  }>;
  temporaryAudioCount: number;
};

/** Simula preparación, conversión y borrado de un archivo temporal de audio. */
export function createSimulatedAudioTranscriber(input: {
  failure?: "conversion-failed" | "provider-unavailable" | "rate-limited";
  transcript?: string;
}): SimulatedAudioTranscriber {
  const attempts: SimulatedAudioTranscriber["attempts"] = [];
  const transcriber: SimulatedAudioTranscriber = {
    attempts,
    temporaryAudioCount: 0,
    async transcribe(request) {
      transcriber.temporaryAudioCount += 1;
      try {
        attempts.push({
          byteLength: request.audio.byteLength,
          contentType: request.contentType,
          model: request.model,
          normalization:
            request.contentType === "audio/ogg" ||
            request.contentType === "audio/opus"
              ? "ogg-opus-to-wav"
              : null,
        });
        if (input.failure !== undefined) throw new Error(input.failure);
        return input.transcript ?? "";
      } finally {
        transcriber.temporaryAudioCount -= 1;
      }
    },
  };
  return transcriber;
}
