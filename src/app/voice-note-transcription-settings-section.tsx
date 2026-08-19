"use client";

import { api } from "~/trpc/react";

/** Control explícito del propietario para permitir notas de voz en Asclepio. */
export function VoiceNoteTranscriptionSettingsSection() {
  const settings = api.panacea.getVoiceTranscriptionSettings.useQuery();
  const save = api.panacea.setVoiceTranscriptionSettings.useMutation({
    onSuccess: () => settings.refetch(),
  });
  const enabled = settings.data?.enabled ?? false;

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Transcripción de nota de voz</h2>
        <p className="mt-1 text-sm text-slate-300">
          La transcripción usa el adaptador simulado de forma temporal. Si falla
          o está desactivado, crea un Escalamiento para atención humana.
        </p>
      </div>
      <label className="block text-sm">
        <input
          checked={enabled}
          disabled={settings.isLoading || save.isPending}
          onChange={(event) => save.mutate({ enabled: event.target.checked })}
          type="checkbox"
        />{" "}
        Permitir transcribir notas de voz
      </label>
    </section>
  );
}
