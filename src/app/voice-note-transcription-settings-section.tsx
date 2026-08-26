"use client";

import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

/** Control explícito del propietario para permitir notas de voz en Asclepio. */
export function VoiceNoteTranscriptionSettingsSection() {
  const settings = api.panacea.getVoiceTranscriptionSettings.useQuery();
  const save = api.panacea.setVoiceTranscriptionSettings.useMutation({
    onSuccess: () => settings.refetch(),
  });
  const enabled = settings.data?.enabled ?? false;

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">
            Transcripción de nota de voz
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            La transcripción usa el adaptador simulado de forma temporal. Si
            falla o está desactivado, crea un Escalamiento para atención humana.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {settings.error ? (
            <PanaceaQueryError
              error={settings.error}
              onRetry={() => void settings.refetch()}
              title="transcripción de nota de voz"
            />
          ) : settings.isLoading ? (
            <PanaceaQueryLoading label="Cargando transcripción de nota de voz" />
          ) : (
            <label className="flex items-start gap-3 text-sm">
              <input
                checked={enabled}
                className="accent-primary mt-0.5 size-4"
                disabled={save.isPending}
                onChange={(event) =>
                  save.mutate({ enabled: event.target.checked })
                }
                type="checkbox"
              />
              <span>Permitir transcribir notas de voz</span>
            </label>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
