"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Switch } from "~/components/ui/switch";
import { api } from "~/trpc/react";
import {
  PanaceaQueryEmpty,
  PanaceaQueryError,
  PanaceaQueryLoading,
} from "./panacea-query-state";
import { WhatsAppPolicyFeedback } from "./whatsapp-policy-feedback";

/** Control explícito del propietario para permitir notas de voz en Asclepio. */
export function VoiceNoteTranscriptionSettingsSection() {
  const settings = api.panacea.getVoiceTranscriptionSettings.useQuery();
  const [enabled, setEnabled] = useState(false);
  const save = api.panacea.setVoiceTranscriptionSettings.useMutation({
    onSuccess: () => {
      void settings.refetch();
    },
  });

  const settingsData = settings.data;
  const savedEnabled = settingsData?.enabled ?? false;
  useEffect(() => {
    if (settingsData !== undefined) {
      setEnabled(settingsData.enabled);
    }
  }, [settingsData]);

  function saveSettings(form?: HTMLFormElement) {
    save.reset();
    const requestedEnabled =
      form === undefined
        ? enabled
        : new FormData(form).get("voice-transcription-enabled") !== null;
    setEnabled(requestedEnabled);
    save.mutate({ enabled: requestedEnabled });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettings(event.currentTarget);
  }

  return (
    <section
      aria-labelledby="voice-transcription-title"
      className="space-y-5"
      data-whatsapp-policy="voice-transcription"
    >
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold" id="voice-transcription-title">
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
          ) : settings.data === undefined ? (
            <PanaceaQueryEmpty
              description="No hay preferencias de transcripción disponibles para este alcance. Vuelva a intentar la carga."
              onRetry={() => void settings.refetch()}
              title="Sin transcripción de nota de voz configurada"
            />
          ) : (
            <form aria-busy={save.isPending} onSubmit={submit}>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="voice-transcription-enabled">
                      Permitir transcribir notas de voz
                    </FieldLabel>
                    <FieldDescription id="voice-transcription-description">
                      Valor actual: {savedEnabled ? "Activado" : "Desactivado"}.
                      Esta preferencia no activa un proveedor externo.
                      {enabled !== savedEnabled ? (
                        <>
                          {" "}
                          Cambio pendiente:{" "}
                          {enabled ? "Activado" : "Desactivado"}.
                        </>
                      ) : null}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    aria-describedby="voice-transcription-description"
                    checked={enabled}
                    disabled={save.isPending}
                    id="voice-transcription-enabled"
                    name="voice-transcription-enabled"
                    onCheckedChange={(checked) => {
                      setEnabled(checked);
                      save.reset();
                    }}
                  />
                </Field>
              </FieldGroup>
              <Button className="mt-5" disabled={save.isPending} type="submit">
                {save.isPending ? "Guardando…" : "Guardar transcripción"}
              </Button>
              <div className="mt-4">
                <WhatsAppPolicyFeedback
                  mutation={save}
                  onRetry={() => saveSettings()}
                  successMessage="La preferencia de transcripción quedó actualizada."
                />
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
